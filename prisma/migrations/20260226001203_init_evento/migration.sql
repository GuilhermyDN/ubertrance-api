/*
  Warnings:

  - Added the required column `eventoId` to the `OperacaoDia` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SaidaTipo" AS ENUM ('IDA', 'VOLTA');

-- CreateEnum
CREATE TYPE "SaidaStatus" AS ENUM ('ABERTA', 'SAIU', 'ENCERRADA');

-- AlterTable
ALTER TABLE "OperacaoDia" ADD COLUMN     "eventoId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Evento" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "localTitulo" TEXT NOT NULL,
    "localDetalhe" TEXT,
    "inicioIdas" TIMESTAMP(3) NOT NULL,
    "fimIdas" TIMESTAMP(3) NOT NULL,
    "tempoRotaMin" INTEGER NOT NULL,
    "minPagantesPorSaida" INTEGER NOT NULL,
    "capacidadeSentado" INTEGER NOT NULL,
    "capacidadeEmPe" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Saida" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "operacaoDiaId" TEXT NOT NULL,
    "tipo" "SaidaTipo" NOT NULL,
    "status" "SaidaStatus" NOT NULL DEFAULT 'ABERTA',
    "estimadaPara" TIMESTAMP(3) NOT NULL,
    "confirmadaPara" TIMESTAMP(3),
    "vendidosNaSaida" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Saida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Evento_ativo_idx" ON "Evento"("ativo");

-- CreateIndex
CREATE INDEX "Evento_inicioIdas_idx" ON "Evento"("inicioIdas");

-- CreateIndex
CREATE INDEX "Evento_fimIdas_idx" ON "Evento"("fimIdas");

-- CreateIndex
CREATE INDEX "Saida_eventoId_tipo_status_idx" ON "Saida"("eventoId", "tipo", "status");

-- CreateIndex
CREATE INDEX "Saida_operacaoDiaId_idx" ON "Saida"("operacaoDiaId");

-- CreateIndex
CREATE INDEX "Saida_estimadaPara_idx" ON "Saida"("estimadaPara");

-- CreateIndex
CREATE INDEX "EventoScanner_tsLocal_idx" ON "EventoScanner"("tsLocal");

-- CreateIndex
CREATE INDEX "OperacaoDia_eventoId_idx" ON "OperacaoDia"("eventoId");

-- CreateIndex
CREATE INDEX "OperacaoDia_status_idx" ON "OperacaoDia"("status");

-- CreateIndex
CREATE INDEX "OperacaoDia_data_idx" ON "OperacaoDia"("data");

-- CreateIndex
CREATE INDEX "PacotePasses_operacaoDiaId_idx" ON "PacotePasses"("operacaoDiaId");

-- CreateIndex
CREATE INDEX "PacotePasses_motoristaId_idx" ON "PacotePasses"("motoristaId");

-- CreateIndex
CREATE INDEX "PacotePasses_produtoId_idx" ON "PacotePasses"("produtoId");

-- CreateIndex
CREATE INDEX "Pass_estado_idx" ON "Pass"("estado");

-- CreateIndex
CREATE INDEX "VendaLocal_tsLocal_idx" ON "VendaLocal"("tsLocal");

-- AddForeignKey
ALTER TABLE "OperacaoDia" ADD CONSTRAINT "OperacaoDia_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "Evento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Saida" ADD CONSTRAINT "Saida_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "Evento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Saida" ADD CONSTRAINT "Saida_operacaoDiaId_fkey" FOREIGN KEY ("operacaoDiaId") REFERENCES "OperacaoDia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
