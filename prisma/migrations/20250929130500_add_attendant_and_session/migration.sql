-- Create tables for Attendant auth/session that are present in schema.prisma but missing in DB

-- Attendant table
CREATE TABLE "public"."Attendant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "outletId" TEXT,
  "loginCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Attendant_pkey" PRIMARY KEY ("id")
);

-- Unique loginCode for Attendant
CREATE UNIQUE INDEX "Attendant_loginCode_key" ON "public"."Attendant"("loginCode");

-- Optional relation to Outlet (by id)
ALTER TABLE "public"."Attendant"
  ADD CONSTRAINT "Attendant_outletId_fkey"
  FOREIGN KEY ("outletId") REFERENCES "public"."Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- LoginCode table (one-time codes bound to an attendant)
CREATE TABLE "public"."LoginCode" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "attendantId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoginCode_code_key" ON "public"."LoginCode"("code");

ALTER TABLE "public"."LoginCode"
  ADD CONSTRAINT "LoginCode_attendantId_fkey"
  FOREIGN KEY ("attendantId") REFERENCES "public"."Attendant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Session table (persistent cookie sessions for attendants)
CREATE TABLE "public"."Session" (
  "id" TEXT NOT NULL,
  "attendantId" TEXT NOT NULL,
  "outletCode" TEXT,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Session_token_key" ON "public"."Session"("token");

ALTER TABLE "public"."Session"
  ADD CONSTRAINT "Session_attendantId_fkey"
  FOREIGN KEY ("attendantId") REFERENCES "public"."Attendant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
