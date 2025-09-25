-- CreateEnum
CREATE TYPE "public"."PersonRole" AS ENUM ('attendant', 'supervisor', 'supplier');

-- CreateEnum
CREATE TYPE "public"."DepositStatus" AS ENUM ('VALID', 'PENDING', 'INVALID');

-- CreateTable
CREATE TABLE "public"."Outlet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Product" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "sellPrice" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PersonCode" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "code" TEXT NOT NULL,
    "role" "public"."PersonRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PersonCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AttendantScope" (
    "id" TEXT NOT NULL,
    "codeNorm" TEXT NOT NULL,
    "outletName" TEXT NOT NULL,

    CONSTRAINT "AttendantScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScopeProduct" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,

    CONSTRAINT "ScopeProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PricebookRow" (
    "id" TEXT NOT NULL,
    "outletName" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "sellPrice" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PricebookRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplyOpeningRow" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "outletName" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "buyPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,

    CONSTRAINT "SupplyOpeningRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplyTransfer" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "fromOutletName" TEXT NOT NULL,
    "toOutletName" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AttendantClosing" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "outletName" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "closingQty" DOUBLE PRECISION NOT NULL,
    "wasteQty" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "AttendantClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AttendantDeposit" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "outletName" TEXT NOT NULL,
    "code" TEXT,
    "note" TEXT,
    "amount" INTEGER NOT NULL,
    "status" "public"."DepositStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendantDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AttendantExpense" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "outletName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendantExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ActivePeriod" (
    "id" TEXT NOT NULL,
    "outletName" TEXT NOT NULL,
    "periodStartAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Setting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_name_key" ON "public"."Outlet"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_key_key" ON "public"."Product"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PersonCode_code_key" ON "public"."PersonCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AttendantScope_codeNorm_key" ON "public"."AttendantScope"("codeNorm");

-- CreateIndex
CREATE UNIQUE INDEX "ScopeProduct_scopeId_productKey_key" ON "public"."ScopeProduct"("scopeId", "productKey");

-- CreateIndex
CREATE UNIQUE INDEX "PricebookRow_outletName_productKey_key" ON "public"."PricebookRow"("outletName", "productKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyOpeningRow_date_outletName_itemKey_key" ON "public"."SupplyOpeningRow"("date", "outletName", "itemKey");

-- CreateIndex
CREATE UNIQUE INDEX "AttendantClosing_date_outletName_itemKey_key" ON "public"."AttendantClosing"("date", "outletName", "itemKey");

-- CreateIndex
CREATE UNIQUE INDEX "ActivePeriod_outletName_key" ON "public"."ActivePeriod"("outletName");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "public"."Setting"("key");

-- AddForeignKey
ALTER TABLE "public"."ScopeProduct" ADD CONSTRAINT "ScopeProduct_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "public"."AttendantScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
