import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

// Minimal set of tables the login flow depends on
const REQUIRED_TABLES = [
  "PersonCode",
  "Outlet",
  "Attendant",
  "LoginCode",
  "Session",
  "Setting",
  // optional helpers used for auto-provisioning
  "AttendantAssignment",
  "AttendantScope",
];

async function tableExists(table: string) {
  try {
    // Try a cheap select; if relation is missing, Postgres will throw
    await (prisma as any).$queryRawUnsafe(`SELECT 1 FROM "${table}" LIMIT 1`);
    return true;
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    // Postgres: relation "X" does not exist
    if (msg.toLowerCase().includes("does not exist")) return false;
    // Prisma error code P2021: table does not exist
    if (String((e as any)?.code || "").toUpperCase() === "P2021") return false;
    // Other errors (permission etc.) — treat as present but note error
    return { error: msg } as any;
  }
}

export async function GET() {
  try {
    if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) {
      return NextResponse.json({ ok: false, error: "DB_NOT_CONFIGURED" }, { status: 503 });
    }

    const results: Record<string, boolean | { error: string }> = {};
    for (const t of REQUIRED_TABLES) {
      const r: any = await tableExists(t);
      results[t] = r === true ? true : r?.error ? { error: r.error } : false;
    }

    const missing = Object.entries(results)
      .filter(([, v]) => v === false)
      .map(([k]) => k);

    const ok = missing.length === 0;
    return NextResponse.json({ ok, missing, tables: results });
  } catch (e: any) {
    const msg = String(e?.message || e || "SERVER_ERROR");
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
