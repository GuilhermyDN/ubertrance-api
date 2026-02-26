import { FastifyInstance } from "fastify";
import { prisma } from "../prisma";
import { z } from "zod";
import crypto from "node:crypto";

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

function signEd25519(payloadStr: string): string {
  const privPem = loadPrivateKeyPem();
  const sig = crypto.sign(null, Buffer.from(payloadStr, "utf8"), privPem);
  return b64url(sig);
}

/**
 * Próxima saída estimada (IDA).
 * Usa última saída confirmada + tempo de rota + mínimo de pagantes.
 */
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
      estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] },
      ...(lastSaida?.confirmadaPara ? { vendidoEm: { gt: lastSaida.confirmadaPara } } : {}),
    },
  });

  if (vendidosDesdeUltima >= evento.minPagantesPorSaida) {
    return new Date(now.getTime() + 10 * 60 * 1000); // 10 min embarque
  }

  if (lastSaida?.confirmadaPara) {
    const next = new Date(lastSaida.confirmadaPara.getTime() + evento.tempoRotaMin * 60 * 1000);
    return next > now ? next : new Date(now.getTime() + 10 * 60 * 1000);
  }

  const first = new Date(evento.inicioIdas.getTime() + 30 * 60 * 1000);
  return first > now ? first : new Date(now.getTime() + 10 * 60 * 1000);
}

export async function adminRoutes(app: FastifyInstance) {
  // POST /admin/eventos
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

  // POST /admin/operacoes
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

  // POST /admin/pacotes  (gera QR assinado por pass)
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
      return reply.code(400).send({ ok: false, message: "Operação não está ATIVA." });
    }

    const motorista = await prisma.motorista.findUnique({
      where: { id: body.motoristaId },
      select: { id: true, ativo: true },
    });
    if (!motorista || !motorista.ativo) {
      return reply.code(400).send({ ok: false, message: "motoristaId inválido ou inativo." });
    }

    const produto = await prisma.produto.findUnique({
      where: { tipo: body.produtoTipo as any },
    });
    if (!produto) {
      return reply
        .code(400)
        .send({ ok: false, message: `Produto ${body.produtoTipo} não existe no banco.` });
    }

    const pacote = await prisma.pacotePasses.create({
      data: {
        operacaoDiaId: body.operacaoDiaId,
        motoristaId: body.motoristaId,
        produtoId: produto.id,
        quantidade: body.quantidade,
      },
    });

    const createdPassIds: string[] = [];

    for (let i = 0; i < body.quantidade; i++) {
      const pass = await prisma.pass.create({
        data: {
          pacoteId: pacote.id,
          operacaoDiaId: body.operacaoDiaId,
          produtoTipo: body.produtoTipo as any,
          payload: "{}",
          sig: "dev",
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
        produtoTipo: body.produtoTipo,
        nonce: b64url(crypto.randomBytes(8)),
        iat,
        exp,
      };

      const payloadStr = JSON.stringify(payloadObj);
      const sig = signEd25519(payloadStr);

      await prisma.pass.update({
        where: { id: pass.id },
        data: { payload: payloadStr, sig },
      });

      createdPassIds.push(pass.id);
    }

    return reply.send({
      ok: true,
      pacoteId: pacote.id,
      quantidadeCriada: createdPassIds.length,
      passes: createdPassIds,
    });
  });

  // POST /admin/saidas/confirmar
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

    if (!op) return reply.code(404).send({ ok: false, message: "Operação não encontrada." });

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
      body.tipo === "IDA" ? await getProximaSaidaEstimada(body.operacaoDiaId) : null;

    return reply.send({ ok: true, saida, proximaSaidaEstimada: proxima });
  });

  // GET /admin/operacoes/:id/resumo
  app.get("/operacoes/:id/resumo", async (req: any, reply) => {
    const { id } = req.params as { id: string };

    const op = await prisma.operacaoDia.findUnique({
      where: { id },
      include: { evento: true },
    });
    if (!op) return reply.code(404).send({ ok: false, message: "Operação não encontrada." });

    const vendidosSentado = await prisma.pass.count({
      where: {
        operacaoDiaId: id,
        produtoTipo: { in: ["IDA", "VOLTA", "COMBO"] as any },
        estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] },
      },
    });

    const vendidosEmPe = await prisma.pass.count({
      where: {
        operacaoDiaId: id,
        produtoTipo: "EM_PE",
        estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] },
      },
    });

    const proxima = await getProximaSaidaEstimada(id);

    return reply.send({
      ok: true,
      operacaoId: id,
      evento: {
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
      vendidos: { sentado: vendidosSentado, emPe: vendidosEmPe },
      capacidadeRestante: {
        sentado: Math.max(0, op.evento.capacidadeSentado - vendidosSentado),
        emPe: Math.max(0, op.evento.capacidadeEmPe - vendidosEmPe),
      },
      proximaSaidaEstimada: proxima,
    });
  });
}