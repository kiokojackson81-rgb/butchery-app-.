-- Alter AttendantAssignment safely: add nullable id, backfill, then enforce NOT NULL and PK
ALTER TABLE "public"."AttendantAssignment" DROP CONSTRAINT IF EXISTS "AttendantAssignment_pkey";
ALTER TABLE "public"."AttendantAssignment" ADD COLUMN IF NOT EXISTS "id" TEXT;

-- If productKeys existed in a different shape, drop and recreate as TEXT[] (data may be lost if previously non-array)
DO $$ BEGIN
    PERFORM 1 FROM information_schema.columns 
     WHERE table_schema = 'public' AND table_name = 'AttendantAssignment' AND column_name = 'productKeys';
    IF FOUND THEN
        ALTER TABLE "public"."AttendantAssignment" DROP COLUMN "productKeys";
    END IF;
END $$;
ALTER TABLE "public"."AttendantAssignment" ADD COLUMN IF NOT EXISTS "productKeys" TEXT[];

-- Backfill id for existing rows where id is NULL using a random md5-based token
UPDATE "public"."AttendantAssignment"
SET "id" = COALESCE("id", 'aa_' || md5(random()::text || clock_timestamp()::text))
WHERE "id" IS NULL;

-- Now enforce NOT NULL and primary key on id
ALTER TABLE "public"."AttendantAssignment" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "public"."AttendantAssignment" ADD CONSTRAINT "AttendantAssignment_pkey" PRIMARY KEY ("id");

-- DropTable (guarded)
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'OpeningLock'
    ) THEN
        EXECUTE 'DROP TABLE "public"."OpeningLock"';
    END IF;
END $$;

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

