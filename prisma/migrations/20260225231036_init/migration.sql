-- CreateEnum
CREATE TYPE "OperacaoStatus" AS ENUM ('ATIVA', 'ENCERRADA');

-- CreateEnum
CREATE TYPE "ProdutoTipo" AS ENUM ('IDA', 'VOLTA', 'COMBO', 'EM_PE');

-- CreateEnum
CREATE TYPE "PassEstado" AS ENUM ('DISPONIVEL', 'VENDIDO', 'USADO_IDA', 'NA_FILA', 'EMBARCOU');

-- CreateEnum
CREATE TYPE "EventoTipo" AS ENUM ('CHECKIN_IDA', 'CHECKIN_VOLTA_FILA', 'EMBARQUE_VOLTA');

-- CreateTable
CREATE TABLE "OperacaoDia" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "status" "OperacaoStatus" NOT NULL DEFAULT 'ATIVA',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperacaoDia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "tipo" "ProdutoTipo" NOT NULL,
    "precoCent" INTEGER NOT NULL,
    "limiteTotal" INTEGER NOT NULL,
    "limiteEmPe" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Motorista" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Motorista_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PacotePasses" (
    "id" TEXT NOT NULL,
    "operacaoDiaId" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PacotePasses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pass" (
    "id" TEXT NOT NULL,
    "pacoteId" TEXT NOT NULL,
    "operacaoDiaId" TEXT NOT NULL,
    "produtoTipo" "ProdutoTipo" NOT NULL,
    "payload" TEXT NOT NULL,
    "sig" TEXT NOT NULL,
    "estado" "PassEstado" NOT NULL DEFAULT 'DISPONIVEL',
    "vendidoNome" TEXT,
    "vendidoTel" TEXT,
    "vendidoEm" TIMESTAMP(3),

    CONSTRAINT "Pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendaLocal" (
    "id" TEXT NOT NULL,
    "passId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "tsLocal" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendaLocal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoScanner" (
    "id" TEXT NOT NULL,
    "passId" TEXT NOT NULL,
    "tipo" "EventoTipo" NOT NULL,
    "tsLocal" TIMESTAMP(3) NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoScanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "motoristaId" TEXT NOT NULL,
    "ultimoSyncEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("motoristaId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Produto_tipo_key" ON "Produto"("tipo");

-- CreateIndex
CREATE INDEX "Pass_pacoteId_idx" ON "Pass"("pacoteId");

-- CreateIndex
CREATE INDEX "Pass_operacaoDiaId_idx" ON "Pass"("operacaoDiaId");

-- CreateIndex
CREATE INDEX "Pass_produtoTipo_idx" ON "Pass"("produtoTipo");

-- CreateIndex
CREATE INDEX "VendaLocal_passId_idx" ON "VendaLocal"("passId");

-- CreateIndex
CREATE INDEX "EventoScanner_motoristaId_idx" ON "EventoScanner"("motoristaId");

-- CreateIndex
CREATE UNIQUE INDEX "EventoScanner_passId_tipo_key" ON "EventoScanner"("passId", "tipo");

-- AddForeignKey
ALTER TABLE "PacotePasses" ADD CONSTRAINT "PacotePasses_operacaoDiaId_fkey" FOREIGN KEY ("operacaoDiaId") REFERENCES "OperacaoDia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PacotePasses" ADD CONSTRAINT "PacotePasses_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "Motorista"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PacotePasses" ADD CONSTRAINT "PacotePasses_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_pacoteId_fkey" FOREIGN KEY ("pacoteId") REFERENCES "PacotePasses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_operacaoDiaId_fkey" FOREIGN KEY ("operacaoDiaId") REFERENCES "OperacaoDia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaLocal" ADD CONSTRAINT "VendaLocal_passId_fkey" FOREIGN KEY ("passId") REFERENCES "Pass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoScanner" ADD CONSTRAINT "EventoScanner_passId_fkey" FOREIGN KEY ("passId") REFERENCES "Pass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoScanner" ADD CONSTRAINT "EventoScanner_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "Motorista"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCursor" ADD CONSTRAINT "SyncCursor_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "Motorista"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
