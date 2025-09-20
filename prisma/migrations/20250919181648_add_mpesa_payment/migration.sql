-- CreateTable
CREATE TABLE "MpesaPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "transType" TEXT,
    "mpesaReceipt" TEXT,
    "amount" INTEGER NOT NULL,
    "msisdn" TEXT,
    "payerName" TEXT,
    "businessShortcode" TEXT,
    "tillNumber" TEXT,
    "billRef" TEXT,
    "accountReference" TEXT,
    "transTime" DATETIME NOT NULL,
    "outlet" TEXT,
    "raw" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "MpesaPayment_mpesaReceipt_key" ON "MpesaPayment"("mpesaReceipt");
