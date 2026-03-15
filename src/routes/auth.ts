import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma";
import { verificarSenha, gerarJwt } from "../lib/auth";

export async function authRoutes(app: FastifyInstance) {
  /**
   * POST /auth/login
   * Body: { email, senha }
   * Response: { ok: true, token, motorista: { id, nome, email } }
   */
  app.post("/login", async (req, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        senha: z.string().min(6),
      })
      .parse(req.body);

    const motorista = await prisma.motorista.findUnique({
      where: { email: body.email },
      select: { id: true, nome: true, email: true, senhaHash: true, ativo: true },
    });

    if (!motorista || !motorista.ativo) {
      return reply
        .code(401)
        .send({ ok: false, message: "Credenciais inválidas." });
    }

    if (!motorista.senhaHash) {
      return reply
        .code(401)
        .send({ ok: false, message: "Credenciais inválidas." });
    }

    const senhaOk = await verificarSenha(body.senha, motorista.senhaHash);
    if (!senhaOk) {
      return reply
        .code(401)
        .send({ ok: false, message: "Credenciais inválidas." });
    }

    const token = gerarJwt(motorista.id);

    return reply.send({
      ok: true,
      token,
      expiresIn: "14d",
      motorista: {
        id: motorista.id,
        nome: motorista.nome,
        email: motorista.email,
      },
    });
  });
}
