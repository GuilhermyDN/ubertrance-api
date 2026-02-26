/*
  Warnings:

  - A unique constraint covering the columns `[motoristaId,idempotencyKey]` on the table `VendaLocal` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `idempotencyKey` to the `VendaLocal` table without a default value. This is not possible if the table is not empty.
  - Added the required column `motoristaId` to the `VendaLocal` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "VendaLocal" ADD COLUMN     "idempotencyKey" TEXT NOT NULL,
ADD COLUMN     "motoristaId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "VendaLocal_motoristaId_idempotencyKey_key" ON "VendaLocal"("motoristaId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "VendaLocal" ADD CONSTRAINT "VendaLocal_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "Motorista"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
