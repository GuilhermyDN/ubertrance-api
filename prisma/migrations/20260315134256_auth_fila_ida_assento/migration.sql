-- Auth: adiciona email e senhaHash ao Motorista
ALTER TABLE "Motorista" ADD COLUMN "email" TEXT;
ALTER TABLE "Motorista" ADD COLUMN "senhaHash" TEXT;

CREATE UNIQUE INDEX "Motorista_email_key" ON "Motorista"("email");

-- Fila de IDA: novo valor no enum EventoTipo
ALTER TYPE "EventoTipo" ADD VALUE IF NOT EXISTS 'CHECKIN_IDA_FILA';

-- Fila de IDA: novo estado NA_FILA_IDA no enum PassEstado
ALTER TYPE "PassEstado" ADD VALUE IF NOT EXISTS 'NA_FILA_IDA';

-- Mapa de assentos: campo assentoId no Pass
ALTER TABLE "Pass" ADD COLUMN "assentoId" INTEGER;
