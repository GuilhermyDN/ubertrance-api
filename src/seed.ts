import "dotenv/config";
import { prisma } from "./prisma";
import { hashSenha } from "./lib/auth";

async function main() {
  // Produtos
  const produtos = [
    { tipo: "IDA", precoCent: 5000, limiteTotal: 50, ativo: true },
    { tipo: "VOLTA", precoCent: 5000, limiteTotal: 50, ativo: true },
    { tipo: "COMBO", precoCent: 9000, limiteTotal: 50, ativo: true },
    { tipo: "EM_PE", precoCent: 3000, limiteTotal: 20, ativo: true },
  ] as const;

  for (const p of produtos) {
    await prisma.produto.upsert({
      where: { tipo: p.tipo as any },
      update: {},
      create: p as any,
    });
  }

  // Motorista com credenciais de teste
  const senhaHash = await hashSenha("senha123");
  const motorista = await prisma.motorista.create({
    data: {
      nome: "Motorista Teste",
      email: "motorista@teste.com",
      senhaHash,
      ativo: true,
    },
  });

  // Evento (exemplo janela 12:00 -> 00:00)
  const evento = await prisma.evento.create({
    data: {
      titulo: "Rave Exemplo",
      localTitulo: "Arena X",
      localDetalhe: "Ponto Y",
      inicioIdas: new Date("2026-03-01T12:00:00.000Z"),
      fimIdas: new Date("2026-03-02T00:00:00.000Z"),
      tempoRotaMin: 90,
      minPagantesPorSaida: 30,
      capacidadeSentado: 30,
      capacidadeEmPe: 10,
      ativo: true,
    },
  });

  // Operação vinculada ao evento
  const operacao = await prisma.operacaoDia.create({
    data: { eventoId: evento.id, data: new Date("2026-03-01T00:00:00.000Z") },
  });

  console.log("SEED_OK");
  console.log({
    motoristaId: motorista.id,
    email: motorista.email,
    senhaTest: "senha123",
    eventoId: evento.id,
    operacaoDiaId: operacao.id,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});