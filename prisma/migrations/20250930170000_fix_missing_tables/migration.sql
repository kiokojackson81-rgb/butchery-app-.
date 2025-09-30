-- AlterTable
ALTER TABLE "public"."AttendantAssignment" DROP CONSTRAINT "AttendantAssignment_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
DROP COLUMN "productKeys",
ADD COLUMN     "productKeys" TEXT[],
ADD CONSTRAINT "AttendantAssignment_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "public"."OpeningLock";

-- CreateTable
CREATE TABLE "public"."PhoneMapping" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "outlet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChatraceSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "apiBase" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "fromPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatraceSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplyRequest" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outlet" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "requestedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Attendant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outletId" TEXT,
    "loginCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoginCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AppState" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."ReviewItem" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "outlet" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WaMessageLog" (
    "id" TEXT NOT NULL,
    "attendantId" TEXT,
    "direction" TEXT NOT NULL,
    "templateName" TEXT,
    "payload" JSONB NOT NULL,
    "waMessageId" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhoneMapping_code_key" ON "public"."PhoneMapping"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Attendant_loginCode_key" ON "public"."Attendant"("loginCode");

-- CreateIndex
CREATE UNIQUE INDEX "LoginCode_code_key" ON "public"."LoginCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WaMessageLog_waMessageId_key" ON "public"."WaMessageLog"("waMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendantAssignment_code_key" ON "public"."AttendantAssignment"("code");

-- AddForeignKey
ALTER TABLE "public"."Attendant" ADD CONSTRAINT "Attendant_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "public"."Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoginCode" ADD CONSTRAINT "LoginCode_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "public"."Attendant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "public"."Attendant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

