import { FastifyInstance } from "fastify";
import { prisma } from "../prisma";
import { z } from "zod";
import crypto from "node:crypto";

type ProdutoTipo = "IDA" | "VOLTA" | "COMBO" | "EM_PE";

function b64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function loadPrivateKeyPem(): string {
  const b64 = process.env.QR_PRIVATE_KEY_B64;
  if (!b64) throw new Error("Missing QR_PRIVATE_KEY_B64 in .env");
  return Buffer.from(b64, "base64").toString("utf8");
}

function loadPublicKeyPem(): string {
  const b64 = process.env.QR_PUBLIC_KEY_B64;
  if (!b64) throw new Error("Missing QR_PUBLIC_KEY_B64 in .env");
  return Buffer.from(b64, "base64").toString("utf8");
}

function signEd25519(payloadStr: string): string {
  const privPem = loadPrivateKeyPem();
  const sig = crypto.sign(null, Buffer.from(payloadStr, "utf8"), privPem);
  return b64url(sig);
}

async function getProximaSaidaEstimada(operacaoDiaId: string) {
  const op = await prisma.operacaoDia.findUnique({
    where: { id: operacaoDiaId },
    include: { evento: true },
  });

  if (!op) return null;

  const { evento } = op;
  const now = new Date();

  const lastSaida = await prisma.saida.findFirst({
    where: { operacaoDiaId, tipo: "IDA" },
    orderBy: { confirmadaPara: "desc" },
    select: { confirmadaPara: true },
  });

  const vendidosDesdeUltima = await prisma.pass.count({
    where: {
      operacaoDiaId,
      estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] as any },
      ...(lastSaida?.confirmadaPara
        ? { vendidoEm: { gt: lastSaida.confirmadaPara } }
        : {}),
    },
  });

  if (vendidosDesdeUltima >= evento.minPagantesPorSaida) {
    return new Date(now.getTime() + 10 * 60 * 1000);
  }

  if (lastSaida?.confirmadaPara) {
    const next = new Date(
      lastSaida.confirmadaPara.getTime() + evento.tempoRotaMin * 60 * 1000
    );
    return next > now ? next : new Date(now.getTime() + 10 * 60 * 1000);
  }

  const first = new Date(evento.inicioIdas.getTime() + 30 * 60 * 1000);
  return first > now ? first : new Date(now.getTime() + 10 * 60 * 1000);
}

export async function adminRoutes(app: FastifyInstance) {
  app.post("/eventos", async (req, reply) => {
    const body = z
      .object({
        titulo: z.string().min(1),
        localTitulo: z.string().min(1),
        localDetalhe: z.string().optional(),
        inicioIdas: z.string(),
        fimIdas: z.string(),
        tempoRotaMin: z.number().int().positive(),
        minPagantesPorSaida: z.number().int().positive(),
        capacidadeSentado: z.number().int().nonnegative(),
        capacidadeEmPe: z.number().int().nonnegative(),
        ativo: z.boolean().optional(),
      })
      .parse(req.body);

    const ev = await prisma.evento.create({
      data: {
        titulo: body.titulo,
        localTitulo: body.localTitulo,
        localDetalhe: body.localDetalhe,
        inicioIdas: new Date(body.inicioIdas),
        fimIdas: new Date(body.fimIdas),
        tempoRotaMin: body.tempoRotaMin,
        minPagantesPorSaida: body.minPagantesPorSaida,
        capacidadeSentado: body.capacidadeSentado,
        capacidadeEmPe: body.capacidadeEmPe,
        ativo: body.ativo ?? true,
      },
    });

    return reply.send({ ok: true, evento: ev });
  });

  app.post("/operacoes", async (req, reply) => {
    const body = z
      .object({
        eventoId: z.string().uuid(),
        dataISO: z.string(),
      })
      .parse(req.body);

    const ev = await prisma.evento.findUnique({ where: { id: body.eventoId } });

    if (!ev) {
      return reply
        .code(400)
        .send({ ok: false, message: "eventoId inválido: evento não existe." });
    }

    const op = await prisma.operacaoDia.create({
      data: {
        eventoId: body.eventoId,
        data: new Date(body.dataISO),
      },
    });

    return reply.send({ ok: true, operacao: op });
  });

  app.post("/pacotes", async (req, reply) => {
    const body = z
      .object({
        operacaoDiaId: z.string().uuid(),
        motoristaId: z.string().uuid(),
        produtoTipo: z.enum(["IDA", "VOLTA", "COMBO", "EM_PE"]),
        quantidade: z.number().int().positive(),
      })
      .parse(req.body);

    const op = await prisma.operacaoDia.findUnique({
      where: { id: body.operacaoDiaId },
      include: { evento: true },
    });

    if (!op) {
      return reply
        .code(400)
        .send({ ok: false, message: "operacaoDiaId inválido: operação não existe." });
    }

    if (op.status !== "ATIVA") {
      return reply
        .code(400)
        .send({ ok: false, message: "Operação não está ATIVA." });
    }

    const motorista = await prisma.motorista.findUnique({
      where: { id: body.motoristaId },
      select: { id: true, ativo: true },
    });

    if (!motorista || !motorista.ativo) {
      return reply
        .code(400)
        .send({ ok: false, message: "motoristaId inválido ou inativo." });
    }

    const produto = await prisma.produto.findUnique({
      where: { tipo: body.produtoTipo as any },
    });

    if (!produto) {
      return reply.code(400).send({
        ok: false,
        message: `Produto ${body.produtoTipo} não existe no banco.`,
      });
    }

    const pacote = await prisma.pacotePasses.create({
      data: {
        operacaoDiaId: body.operacaoDiaId,
        motoristaId: body.motoristaId,
        produtoId: produto.id,
        quantidade: body.quantidade,
      },
    });

    // calcula o próximo assentoId disponível para esta operação
    const maxAssento = await prisma.pass.aggregate({
      where: { operacaoDiaId: body.operacaoDiaId },
      _max: { assentoId: true },
    });
    let nextAssento = (maxAssento._max.assentoId ?? 0) + 1;

    const createdPasses: Array<{
      id: string;
      assentoId: number;
      payload: string;
      sig: string;
    }> = [];

    for (let i = 0; i < body.quantidade; i++) {
      const assentoId = nextAssento++;

      const pass = await prisma.pass.create({
        data: {
          pacoteId: pacote.id,
          operacaoDiaId: body.operacaoDiaId,
          produtoTipo: body.produtoTipo as any,
          assentoId,
          payload: "{}",
          sig: "pending",
        },
        select: { id: true },
      });

      const iat = Date.now();
      const exp = op.evento.fimIdas.getTime() + 24 * 60 * 60 * 1000;

      const payloadObj = {
        v: 1,
        passId: pass.id,
        operacaoDiaId: body.operacaoDiaId,
        eventoId: op.eventoId,
        produto: body.produtoTipo,
        produtoTipo: body.produtoTipo,
        motoristaId: body.motoristaId,
        assentoId,
        nonce: b64url(crypto.randomBytes(8)),
        iat,
        exp,
      };

      const payloadStr = JSON.stringify(payloadObj);
      const sig = signEd25519(payloadStr);

      await prisma.pass.update({
        where: { id: pass.id },
        data: {
          payload: payloadStr,
          sig,
        },
      });

      createdPasses.push({
        id: pass.id,
        assentoId,
        payload: payloadStr,
        sig,
      });
    }

    return reply.send({
      ok: true,
      pacote: {
        id: pacote.id,
        operacaoDiaId: pacote.operacaoDiaId,
        motoristaId: body.motoristaId,
        produtoTipo: body.produtoTipo,
        quantidade: createdPasses.length,
      },
      publicKeyPem: loadPublicKeyPem(),
      passes: createdPasses,
    });
  });

  app.post("/saidas/confirmar", async (req, reply) => {
    const body = z
      .object({
        operacaoDiaId: z.string().uuid(),
        tipo: z.enum(["IDA", "VOLTA"]),
      })
      .parse(req.body);

    const op = await prisma.operacaoDia.findUnique({
      where: { id: body.operacaoDiaId },
      include: { evento: true },
    });

    if (!op) {
      return reply
        .code(404)
        .send({ ok: false, message: "Operação não encontrada." });
    }

    const now = new Date();

    const saida = await prisma.saida.create({
      data: {
        operacaoDiaId: body.operacaoDiaId,
        eventoId: op.eventoId,
        tipo: body.tipo,
        status: "SAIU",
        confirmadaPara: now,
        estimadaPara: now,
      },
    });

    const proxima =
      body.tipo === "IDA"
        ? await getProximaSaidaEstimada(body.operacaoDiaId)
        : null;

    return reply.send({
      ok: true,
      saida,
      proximaSaidaEstimada: proxima,
    });
  });

  app.get("/operacoes/:id/resumo", async (req: any, reply) => {
    const { id } = req.params as { id: string };

    const op = await prisma.operacaoDia.findUnique({
      where: { id },
      include: { evento: true },
    });

    if (!op) {
      return reply
        .code(404)
        .send({ ok: false, message: "Operação não encontrada." });
    }

    const vendidosSentado = await prisma.pass.count({
      where: {
        operacaoDiaId: id,
        produtoTipo: { in: ["IDA", "VOLTA", "COMBO"] as any },
        estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] as any },
      },
    });

    const vendidosEmPe = await prisma.pass.count({
      where: {
        operacaoDiaId: id,
        produtoTipo: "EM_PE",
        estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] as any },
      },
    });

    const proxima = await getProximaSaidaEstimada(id);

    return reply.send({
      ok: true,
      operacaoId: id,
      operacao: {
        id: op.id,
        data: op.data,
        status: op.status,
      },
      evento: {
        id: op.evento.id,
        titulo: op.evento.titulo,
        localTitulo: op.evento.localTitulo,
        localDetalhe: op.evento.localDetalhe,
        inicioIdas: op.evento.inicioIdas,
        fimIdas: op.evento.fimIdas,
        tempoRotaMin: op.evento.tempoRotaMin,
        minPagantesPorSaida: op.evento.minPagantesPorSaida,
        capacidadeSentado: op.evento.capacidadeSentado,
        capacidadeEmPe: op.evento.capacidadeEmPe,
      },
      vendidos: {
        sentado: vendidosSentado,
        emPe: vendidosEmPe,
      },
      capacidadeRestante: {
        sentado: Math.max(0, op.evento.capacidadeSentado - vendidosSentado),
        emPe: Math.max(0, op.evento.capacidadeEmPe - vendidosEmPe),
      },
      proximaSaidaEstimada: proxima,
    });
  });

  app.post("/confirmar-pagamento", async (req, reply) => {
    const body = z
      .object({
        pendenciaToken: z.string().min(10),
        motoristaId: z.string().uuid(),
      })
      .parse(req.body);

    let pendencia: {
      kind: "PENDENTE_CLIENTE";
      nome: string;
      telefone: string;
      produtoTipo: ProdutoTipo;
      quantidade: number;
      operacaoDiaId: string;
      eventoId: string;
      precoUnitCent: number;
      precoTotalCent: number;
      criadoEm: string;
    };

    try {
      pendencia = JSON.parse(
        Buffer.from(body.pendenciaToken, "base64").toString("utf8")
      );
    } catch {
      return reply
        .code(400)
        .send({ ok: false, message: "pendenciaToken inválido." });
    }

    if (pendencia.kind !== "PENDENTE_CLIENTE") {
      return reply
        .code(400)
        .send({ ok: false, message: "pendenciaToken inválido." });
    }

    const op = await prisma.operacaoDia.findUnique({
      where: { id: pendencia.operacaoDiaId },
      include: { evento: true },
    });

    if (!op) {
      return reply
        .code(404)
        .send({ ok: false, message: "Operação não encontrada." });
    }

    if (op.status !== "ATIVA") {
      return reply
        .code(400)
        .send({ ok: false, message: "Operação não está ATIVA." });
    }

    const motorista = await prisma.motorista.findUnique({
      where: { id: body.motoristaId },
      select: { id: true, ativo: true },
    });

    if (!motorista || !motorista.ativo) {
      return reply
        .code(400)
        .send({ ok: false, message: "motoristaId inválido ou inativo." });
    }

    const produto = await prisma.produto.findUnique({
      where: { tipo: pendencia.produtoTipo as any },
    });

    if (!produto) {
      return reply
        .code(400)
        .send({ ok: false, message: "Produto não encontrado." });
    }

    const pacote = await prisma.pacotePasses.create({
      data: {
        operacaoDiaId: pendencia.operacaoDiaId,
        motoristaId: body.motoristaId,
        produtoId: produto.id,
        quantidade: pendencia.quantidade,
      },
    });

    // calcula o próximo assentoId disponível para esta operação
    const maxAssento2 = await prisma.pass.aggregate({
      where: { operacaoDiaId: pendencia.operacaoDiaId },
      _max: { assentoId: true },
    });
    let nextAssento2 = (maxAssento2._max.assentoId ?? 0) + 1;

    const passesCriados: Array<{
      id: string;
      assentoId: number | null;
      estado: string;
      produtoTipo: string;
      payload: string;
      sig: string;
      vendidoNome: string | null;
      vendidoTel: string | null;
      vendidoEm: Date | null;
    }> = [];

    for (let i = 0; i < pendencia.quantidade; i++) {
      const assentoId2 = nextAssento2++;

      const pass = await prisma.pass.create({
        data: {
          pacoteId: pacote.id,
          operacaoDiaId: pendencia.operacaoDiaId,
          produtoTipo: pendencia.produtoTipo as any,
          assentoId: assentoId2,
          payload: "{}",
          sig: "pending",
          estado: "VENDIDO" as any,
          vendidoNome: pendencia.nome,
          vendidoTel: pendencia.telefone,
          vendidoEm: new Date(),
        },
        select: {
          id: true,
          estado: true,
          produtoTipo: true,
          vendidoNome: true,
          vendidoTel: true,
          vendidoEm: true,
        },
      });

      const iat = Date.now();
      const exp = op.evento.fimIdas.getTime() + 24 * 60 * 60 * 1000;

      const payloadObj = {
        v: 1,
        passId: pass.id,
        operacaoDiaId: pendencia.operacaoDiaId,
        eventoId: op.eventoId,
        produto: pendencia.produtoTipo,
        produtoTipo: pendencia.produtoTipo,
        motoristaId: body.motoristaId,
        assentoId: assentoId2,
        nonce: b64url(crypto.randomBytes(8)),
        iat,
        exp,
      };

      const payloadStr = JSON.stringify(payloadObj);
      const sig = signEd25519(payloadStr);

      const updated = await prisma.pass.update({
        where: { id: pass.id },
        data: {
          payload: payloadStr,
          sig,
        },
        select: {
          id: true,
          assentoId: true,
          estado: true,
          produtoTipo: true,
          payload: true,
          sig: true,
          vendidoNome: true,
          vendidoTel: true,
          vendidoEm: true,
        },
      });

      passesCriados.push(updated);
    }

    return reply.send({
      ok: true,
      pagamento: "CONFIRMADO",
      pacoteId: pacote.id,
      totalEmitido: passesCriados.length,
      passes: passesCriados,
    });
  });
}