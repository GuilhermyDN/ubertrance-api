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

function signEd25519(payloadStr: string): string {
    const privPem = loadPrivateKeyPem();
    const sig = crypto.sign(null, Buffer.from(payloadStr, "utf8"), privPem);
    return b64url(sig);
}

async function getOperacaoAtiva() {
    return prisma.operacaoDia.findFirst({
        where: { status: "ATIVA" },
        orderBy: { criadoEm: "desc" },
        include: { evento: true },
    });
}

async function assertCapacidadeCliente(
    operacaoDiaId: string,
    produtoTipo: ProdutoTipo
) {
    const op = await prisma.operacaoDia.findUnique({
        where: { id: operacaoDiaId },
        include: { evento: true },
    });

    if (!op) {
        return { ok: false as const, message: "Operação não existe." };
    }

    const vendidosSentado = await prisma.pass.count({
        where: {
            operacaoDiaId,
            produtoTipo: { in: ["IDA", "VOLTA", "COMBO"] as any },
            estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] as any },
        },
    });

    const vendidosEmPe = await prisma.pass.count({
        where: {
            operacaoDiaId,
            produtoTipo: "EM_PE",
            estado: { in: ["VENDIDO", "USADO_IDA", "NA_FILA", "EMBARCOU"] as any },
        },
    });

    if (produtoTipo !== "EM_PE" && vendidosSentado >= op.evento.capacidadeSentado) {
        return {
            ok: false as const,
            message: "Capacidade de assentos esgotada para esta operação.",
        };
    }

    if (produtoTipo === "EM_PE" && vendidosEmPe >= op.evento.capacidadeEmPe) {
        return {
            ok: false as const,
            message: "Capacidade EM_PE esgotada para esta operação.",
        };
    }

    return { ok: true as const, op };
}

async function findProdutoByTipo(tipo: ProdutoTipo) {
    return prisma.produto.findUnique({
        where: { tipo: tipo as any },
    });
}

export async function clientRoutes(app: FastifyInstance) {
    // POST /cliente/compra
    // POC: cria compra pendente, sem emitir pass ainda.
    app.post("/compra", async (req, reply) => {
        const body = z
            .object({
                nome: z.string().min(1),
                telefone: z.string().min(8),
                produtoTipo: z.enum(["IDA", "VOLTA", "COMBO", "EM_PE"]),
                quantidade: z.number().int().positive().max(10).default(1),
            })
            .parse(req.body);

        const operacao = await getOperacaoAtiva();

        if (!operacao) {
            return reply
                .code(404)
                .send({ ok: false, message: "Sem operação ATIVA." });
        }

        const produto = await findProdutoByTipo(body.produtoTipo);
        if (!produto || !produto.ativo) {
            return reply
                .code(400)
                .send({ ok: false, message: "Produto inválido ou inativo." });
        }

        const cap = await assertCapacidadeCliente(operacao.id, body.produtoTipo);
        if (!cap.ok) {
            return reply.code(400).send({ ok: false, message: cap.message });
        }

        const pendencia = {
            kind: "PENDENTE_CLIENTE",
            nome: body.nome,
            telefone: body.telefone,
            produtoTipo: body.produtoTipo,
            quantidade: body.quantidade,
            operacaoDiaId: operacao.id,
            eventoId: operacao.eventoId,
            precoUnitCent: produto.precoCent,
            precoTotalCent: produto.precoCent * body.quantidade,
            criadoEm: new Date().toISOString(),
        };

        return reply.send({
            ok: true,
            compra: {
                status: "PENDENTE",
                operacaoDiaId: operacao.id,
                eventoId: operacao.eventoId,
                nome: body.nome,
                telefone: body.telefone,
                produtoTipo: body.produtoTipo,
                quantidade: body.quantidade,
                precoUnitCent: produto.precoCent,
                precoTotalCent: produto.precoCent * body.quantidade,
                pendenciaToken: Buffer.from(JSON.stringify(pendencia), "utf8").toString("base64"),
            },
        });
    });

    // GET /cliente/passes?telefone=11999999999
    app.get("/passes", async (req: any, reply) => {
        const query = z
            .object({
                telefone: z.string().min(8),
            })
            .parse(req.query);

        const passes = await prisma.pass.findMany({
            where: {
                vendidoTel: query.telefone,
            },
            select: {
                id: true,
                operacaoDiaId: true,
                produtoTipo: true,
                estado: true,
                payload: true,
                sig: true,
                vendidoNome: true,
                vendidoTel: true,
                vendidoEm: true,
            },
            orderBy: { vendidoEm: "desc" },
        });

        return reply.send({
            ok: true,
            telefone: query.telefone,
            total: passes.length,
            passes,
        });
    });

    // GET /cliente/operacao/ativa
    app.get("/operacao/ativa", async (_req, reply) => {
        const operacao = await getOperacaoAtiva();

        if (!operacao) {
            return reply
                .code(404)
                .send({ ok: false, message: "Sem operação ATIVA." });
        }

        const produtos = await prisma.produto.findMany({
            where: { ativo: true },
            orderBy: { tipo: "asc" },
            select: {
                id: true,
                tipo: true,
                precoCent: true,
                limiteTotal: true,
                ativo: true,
            },
        });

        return reply.send({
            ok: true,
            operacao: {
                id: operacao.id,
                status: operacao.status,
                data: operacao.data,
            },
            evento: {
                id: operacao.evento.id,
                titulo: operacao.evento.titulo,
                localTitulo: operacao.evento.localTitulo,
                localDetalhe: operacao.evento.localDetalhe,
                inicioIdas: operacao.evento.inicioIdas,
                fimIdas: operacao.evento.fimIdas,
                tempoRotaMin: operacao.evento.tempoRotaMin,
                minPagantesPorSaida: operacao.evento.minPagantesPorSaida,
                capacidadeSentado: operacao.evento.capacidadeSentado,
                capacidadeEmPe: operacao.evento.capacidadeEmPe,
            },
            produtos,
        });
    });
}