import { FastifyInstance } from "fastify";
import { prisma } from "../prisma";
import { z } from "zod";
import crypto from "node:crypto";

function getMotoristaId(req: any) {
  return String(req.headers["x-motorista-id"] || "").trim();
}

function loadPublicKeyPem(): string {
  const b64 = process.env.QR_PUBLIC_KEY_B64;
  if (!b64) throw new Error("Missing QR_PUBLIC_KEY_B64 in .env");
  return Buffer.from(b64, "base64").toString("utf8");
}

function b64urlToBuf(s: string) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(b64, "base64");
}

/**
 * Validação OFFLINE (mesma lógica do app):
 * - verifica assinatura ed25519 do payload
 * - verifica exp (tempo)
 */
export function verifyQrOffline(payloadStr: string, sigB64Url: string, publicKeyPem: string) {
  const sig = b64urlToBuf(sigB64Url);
  const okSig = crypto.verify(null, Buffer.from(payloadStr, "utf8"), publicKeyPem, sig);
  if (!okSig) return { ok: false as const, reason: "INVALID_SIGNATURE" };

  let payload: any;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return { ok: false as const, reason: "INVALID_PAYLOAD_JSON" };
  }

  if (typeof payload?.exp !== "number") return { ok: false as const, reason: "MISSING_EXP" };
  if (Date.now() > payload.exp) return { ok: false as const, reason: "EXPIRED" };

  if (!payload?.passId || !payload?.operacaoDiaId || !payload?.eventoId) {
    return { ok: false as const, reason: "MISSING_FIELDS" };
  }

  return { ok: true as const, payload };
}

function isDentroJanelaIda(inicio: Date, fim: Date) {
  const now = new Date();
  return now >= inicio && now <= fim;
}

async function assertCapacidade(operacaoDiaId: string, produtoTipo: "IDA" | "VOLTA" | "COMBO" | "EM_PE") {
  const op = await prisma.operacaoDia.findUnique({
    where: { id: operacaoDiaId },
    include: { evento: true },
  });
  if (!op) return { ok: false as const, message: "Operação não existe." };

  const sentadoTipos = ["IDA", "VOLTA", "COMBO"] as const;

  const vendidosSentado = await prisma.pass.count({
    where: {
      operacaoDiaId,
      produtoTipo: { in: sentadoTipos as any },
      estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] },
    },
  });

  const vendidosEmPe = await prisma.pass.count({
    where: {
      operacaoDiaId,
      produtoTipo: "EM_PE",
      estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] },
    },
  });

  if (produtoTipo !== "EM_PE" && vendidosSentado >= op.evento.capacidadeSentado) {
    return { ok: false as const, message: "Capacidade de assentos excedida para este evento." };
  }
  if (produtoTipo === "EM_PE" && vendidosEmPe >= op.evento.capacidadeEmPe) {
    return { ok: false as const, message: "Capacidade EM_PE excedida para este evento." };
  }

  return { ok: true as const, op };
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
      estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] },
      ...(lastSaida?.confirmadaPara
        ? { vendidoEm: { gt: lastSaida.confirmadaPara } }
        : {}),
    },
  });

  if (vendidosDesdeUltima >= evento.minPagantesPorSaida) {
    return new Date(now.getTime() + 10 * 60 * 1000);
  }

  if (lastSaida?.confirmadaPara) {
    const next = new Date(lastSaida.confirmadaPara.getTime() + evento.tempoRotaMin * 60 * 1000);
    return next > now ? next : new Date(now.getTime() + 10 * 60 * 1000);
  }

  const first = new Date(evento.inicioIdas.getTime() + 30 * 60 * 1000);
  return first > now ? first : new Date(now.getTime() + 10 * 60 * 1000);
}

export async function driverRoutes(app: FastifyInstance) {
  // GET /driver/qr/public-key  (para o app pegar e cachear)
  app.get("/qr/public-key", async (_req, reply) => {
    const pem = loadPublicKeyPem();
    return reply.send({ ok: true, publicKeyPem: pem });
  });

  // GET /driver/pacotes/ativo  (inclui payload+sig para gerar QR)
  app.get("/pacotes/ativo", async (req: any, reply) => {
    const motoristaId = getMotoristaId(req);
    if (!motoristaId) return reply.code(401).send({ ok: false, message: "Missing x-motorista-id" });

    const op = await prisma.operacaoDia.findFirst({
      where: { status: "ATIVA" },
      orderBy: { criadoEm: "desc" },
      include: { evento: true },
    });
    if (!op) return reply.code(404).send({ ok: false, message: "Sem operação ATIVA." });

    const pacotes = await prisma.pacotePasses.findMany({
      where: { operacaoDiaId: op.id, motoristaId },
      include: {
        produto: true,
        passes: {
          select: {
            id: true,
            estado: true,
            produtoTipo: true,
            payload: true,
            sig: true,
            vendidoNome: true,
            vendidoTel: true,
            vendidoEm: true,
          },
        },
      },
      orderBy: { criadoEm: "desc" },
    });

    const vendidosSentado = await prisma.pass.count({
      where: {
        operacaoDiaId: op.id,
        produtoTipo: { in: ["IDA", "VOLTA", "COMBO"] as any },
        estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] },
      },
    });
    const vendidosEmPe = await prisma.pass.count({
      where: {
        operacaoDiaId: op.id,
        produtoTipo: "EM_PE",
        estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] },
      },
    });

    const proxima = await getProximaSaidaEstimada(op.id);

    return reply.send({
      ok: true,
      operacao: { id: op.id, status: op.status, data: op.data },
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
      capacidadeRestante: {
        sentado: Math.max(0, op.evento.capacidadeSentado - vendidosSentado),
        emPe: Math.max(0, op.evento.capacidadeEmPe - vendidosEmPe),
      },
      proximaSaidaEstimada: proxima,
      pacotes,
    });
  });

  // POST /driver/vender (online) + janela + capacidade
  app.post("/vender", async (req: any, reply) => {
    const motoristaId = getMotoristaId(req);
    if (!motoristaId) return reply.code(401).send({ ok: false, message: "Missing x-motorista-id" });

    const body = z
      .object({
        passId: z.string(),
        nome: z.string().min(1),
        telefone: z.string().min(8),
      })
      .parse(req.body);

    const pass = await prisma.pass.findUnique({ where: { id: body.passId } });
    if (!pass) return reply.code(404).send({ ok: false, message: "Pass não encontrado." });

    const pacote = await prisma.pacotePasses.findUnique({
      where: { id: pass.pacoteId },
      select: { motoristaId: true },
    });
    if (!pacote || pacote.motoristaId !== motoristaId) {
      return reply.code(403).send({ ok: false, message: "Pass não pertence a este motorista." });
    }

    if (pass.estado !== "DISPONIVEL") {
      return reply.code(400).send({ ok: false, message: `Pass não está DISPONIVEL (estado=${pass.estado}).` });
    }

    const cap = await assertCapacidade(pass.operacaoDiaId, pass.produtoTipo as any);
    if (!cap.ok) return reply.code(400).send({ ok: false, message: cap.message });

    // janela de ida (aplica só para venda de IDA/COMBO; ajuste se quiser)
    if (cap.ok && cap.op && (pass.produtoTipo === "IDA" || pass.produtoTipo === "COMBO")) {
      if (!isDentroJanelaIda(cap.op.evento.inicioIdas, cap.op.evento.fimIdas)) {
        return reply.code(400).send({ ok: false, message: "Fora da janela de vendas de IDA." });
      }
    }

    const updated = await prisma.pass.update({
      where: { id: body.passId },
      data: {
        estado: "VENDIDO",
        vendidoNome: body.nome,
        vendidoTel: body.telefone,
        vendidoEm: new Date(),
      },
    });

    return reply.send({ ok: true, pass: updated });
  });

  // POST /driver/scan  (ANTIFRAUDE + registra evento)
  // Você recebe (payload + sig) do QR e o "tipo" do scan.
  app.post("/scan", async (req: any, reply) => {
    const motoristaId = getMotoristaId(req);
    if (!motoristaId) return reply.code(401).send({ ok: false, message: "Missing x-motorista-id" });

    const body = z
      .object({
        tipo: z.enum(["CHECKIN_IDA", "CHECKIN_VOLTA_FILA", "EMBARQUE_VOLTA"]),
        qrPayload: z.string().min(10),
        qrSig: z.string().min(10),
      })
      .parse(req.body);

    const pubPem = loadPublicKeyPem();

    // 1) valida assinatura + exp (offline)
    const off = verifyQrOffline(body.qrPayload, body.qrSig, pubPem);
    if (!off.ok) {
      return reply.code(400).send({ ok: false, message: `QR inválido: ${off.reason}` });
    }

    const p = off.payload as any;

    // 2) antifraude: confirma que payload+sig batem com o que foi emitido e salvo no banco
    const pass = await prisma.pass.findUnique({ where: { id: String(p.passId) } });
    if (!pass) return reply.code(404).send({ ok: false, message: "Pass não existe." });

    if (pass.payload !== body.qrPayload || pass.sig !== body.qrSig) {
      return reply.code(400).send({ ok: false, message: "QR não corresponde ao pass emitido (payload/sig mismatch)." });
    }

    // 3) antifraude: garante que o pass pertence ao motorista (na POC)
    const pacote = await prisma.pacotePasses.findUnique({
      where: { id: pass.pacoteId },
      select: { motoristaId: true },
    });
    if (!pacote || pacote.motoristaId !== motoristaId) {
      return reply.code(403).send({ ok: false, message: "Este pass não pertence a este motorista." });
    }

    // 4) antifraude: valida que operação/evento batem
    const op = await prisma.operacaoDia.findUnique({
      where: { id: pass.operacaoDiaId },
      include: { evento: true },
    });
    if (!op) return reply.code(400).send({ ok: false, message: "Operação inválida do pass." });

    if (String(p.operacaoDiaId) !== pass.operacaoDiaId || String(p.eventoId) !== op.eventoId) {
      return reply.code(400).send({ ok: false, message: "QR não pertence a esta operação/evento." });
    }

    // 5) regras de estado (antifraude de replay por fluxo)
    // CHECKIN_IDA: só se VENDIDO
    if (body.tipo === "CHECKIN_IDA" && pass.estado !== "VENDIDO") {
      return reply.code(400).send({ ok: false, message: `CHECKIN_IDA inválido para estado=${pass.estado}` });
    }
    // CHECKIN_VOLTA_FILA: precisa ter usado ida ou (se VOLTA-only) pelo menos VENDIDO
    if (body.tipo === "CHECKIN_VOLTA_FILA" && !["USADO_IDA", "VENDIDO"].includes(pass.estado)) {
      return reply.code(400).send({ ok: false, message: `CHECKIN_VOLTA_FILA inválido para estado=${pass.estado}` });
    }
    // EMBARQUE_VOLTA: só se NA_FILA
    if (body.tipo === "EMBARQUE_VOLTA" && pass.estado !== "NA_FILA") {
      return reply.code(400).send({ ok: false, message: `EMBARQUE_VOLTA inválido para estado=${pass.estado}` });
    }

    // 6) grava evento idempotente (unique(passId,tipo))
    try {
      await prisma.eventoScanner.create({
        data: {
          passId: pass.id,
          tipo: body.tipo as any,
          tsLocal: new Date(),
          motoristaId,
        },
      });
    } catch {
      return reply.code(200).send({ ok: true, alreadyRecorded: true });
    }

    // 7) atualiza estado
    if (body.tipo === "CHECKIN_IDA") {
      await prisma.pass.update({ where: { id: pass.id }, data: { estado: "USADO_IDA" } });
    } else if (body.tipo === "CHECKIN_VOLTA_FILA") {
      await prisma.pass.update({ where: { id: pass.id }, data: { estado: "NA_FILA" } });
    } else if (body.tipo === "EMBARQUE_VOLTA") {
      await prisma.pass.update({ where: { id: pass.id }, data: { estado: "EMBARCOU" } });
    }

    return reply.send({ ok: true });
  });

  // POST /driver/sync  (offline -> online) com idempotência de vendas + janela + capacidade
  app.post("/sync", async (req: any, reply) => {
    const motoristaId = getMotoristaId(req);
    if (!motoristaId) return reply.code(401).send({ ok: false, message: "Missing x-motorista-id" });

    const body = z
      .object({
        vendas: z
          .array(
            z.object({
              idempotencyKey: z.string().min(6),
              passId: z.string(),
              nome: z.string().min(1),
              telefone: z.string().min(8),
              tsLocalISO: z.string(),
            })
          )
          .default([]),
        eventos: z
          .array(
            z.object({
              passId: z.string(),
              tipo: z.enum(["CHECKIN_IDA", "CHECKIN_VOLTA_FILA", "EMBARQUE_VOLTA"]),
              tsLocalISO: z.string(),
            })
          )
          .default([]),
      })
      .parse(req.body);

    const results = { ok: true, vendas_ok: 0, vendas_skip: 0, eventos_ok: 0, eventos_skip: 0 };

    for (const v of body.vendas) {
      const pass = await prisma.pass.findUnique({ where: { id: v.passId } });
      if (!pass) { results.vendas_skip++; continue; }

      const pacote = await prisma.pacotePasses.findUnique({ where: { id: pass.pacoteId }, select: { motoristaId: true } });
      if (!pacote || pacote.motoristaId !== motoristaId) { results.vendas_skip++; continue; }

      // capacidade/janela só se ainda estava disponível
      if (pass.estado === "DISPONIVEL") {
        const cap = await assertCapacidade(pass.operacaoDiaId, pass.produtoTipo as any);
        if (!cap.ok) { results.vendas_skip++; continue; }

        if (cap.ok && cap.op && (pass.produtoTipo === "IDA" || pass.produtoTipo === "COMBO")) {
          if (!isDentroJanelaIda(cap.op.evento.inicioIdas, cap.op.evento.fimIdas)) {
            results.vendas_skip++;
            continue;
          }
        }
      }

      // idempotência de venda por (motoristaId,idempotencyKey)
      try {
        await prisma.vendaLocal.create({
          data: {
            passId: v.passId,
            motoristaId,
            idempotencyKey: v.idempotencyKey,
            nome: v.nome,
            telefone: v.telefone,
            tsLocal: new Date(v.tsLocalISO),
          },
        });
      } catch {
        // reenviado: ok
      }

      if (pass.estado === "DISPONIVEL") {
        await prisma.pass.update({
          where: { id: v.passId },
          data: {
            estado: "VENDIDO",
            vendidoNome: v.nome,
            vendidoTel: v.telefone,
            vendidoEm: new Date(),
          },
        }).catch(() => {});
      }

      results.vendas_ok++;
    }

    // eventos (server-side idempotente + transição estado)
    for (const e of body.eventos) {
      const pass = await prisma.pass.findUnique({ where: { id: e.passId } });
      if (!pass) { results.eventos_skip++; continue; }

      const pacote = await prisma.pacotePasses.findUnique({ where: { id: pass.pacoteId }, select: { motoristaId: true } });
      if (!pacote || pacote.motoristaId !== motoristaId) { results.eventos_skip++; continue; }

      try {
        await prisma.eventoScanner.create({
          data: {
            passId: e.passId,
            tipo: e.tipo as any,
            tsLocal: new Date(e.tsLocalISO),
            motoristaId,
          },
        });
        results.eventos_ok++;
      } catch {
        results.eventos_skip++;
      }

      if (e.tipo === "CHECKIN_IDA") {
        await prisma.pass.update({ where: { id: e.passId }, data: { estado: "USADO_IDA" } }).catch(() => {});
      } else if (e.tipo === "CHECKIN_VOLTA_FILA") {
        await prisma.pass.update({ where: { id: e.passId }, data: { estado: "NA_FILA" } }).catch(() => {});
      } else if (e.tipo === "EMBARQUE_VOLTA") {
        await prisma.pass.update({ where: { id: e.passId }, data: { estado: "EMBARCOU" } }).catch(() => {});
      }
    }

    await prisma.syncCursor.upsert({
      where: { motoristaId },
      update: { ultimoSyncEm: new Date() },
      create: { motoristaId, ultimoSyncEm: new Date() },
    });

    return reply.send(results);
  });
}