import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Creates Attendant, LoginCode, Session tables if missing.
// Safe to call multiple times; uses IF NOT EXISTS on tables and indexes.
export async function POST() {
  try {
    // Create Attendant
    await (prisma as any).$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "public"."Attendant" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "outletId" TEXT,
        "loginCode" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Attendant_pkey" PRIMARY KEY ("id")
      );
    `);
    await (prisma as any).$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'Attendant_outletId_fkey'
        ) THEN
          ALTER TABLE "public"."Attendant"
            ADD CONSTRAINT "Attendant_outletId_fkey"
            FOREIGN KEY ("outletId") REFERENCES "public"."Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    await (prisma as any).$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Attendant_loginCode_key" ON "public"."Attendant"("loginCode");
    `);

    // Create LoginCode
    await (prisma as any).$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "public"."LoginCode" (
        "id" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "attendantId" TEXT NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
      );
    `);
    await (prisma as any).$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "LoginCode_code_key" ON "public"."LoginCode"("code");
    `);
    await (prisma as any).$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'LoginCode_attendantId_fkey'
        ) THEN
          ALTER TABLE "public"."LoginCode"
            ADD CONSTRAINT "LoginCode_attendantId_fkey"
            FOREIGN KEY ("attendantId") REFERENCES "public"."Attendant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // Create Session
    await (prisma as any).$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "public"."Session" (
        "id" TEXT NOT NULL,
        "attendantId" TEXT NOT NULL,
        "outletCode" TEXT,
        "token" TEXT NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
      );
    `);
    await (prisma as any).$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Session_token_key" ON "public"."Session"("token");
    `);
    await (prisma as any).$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'Session_attendantId_fkey'
        ) THEN
          ALTER TABLE "public"."Session"
            ADD CONSTRAINT "Session_attendantId_fkey"
            FOREIGN KEY ("attendantId") REFERENCES "public"."Attendant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET() {
  // Allow GET for convenience
  return POST();
}
