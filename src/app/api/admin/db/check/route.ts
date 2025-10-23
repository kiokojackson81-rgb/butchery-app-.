import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

// Protected diagnostic endpoint. Requires header 'x-admin-check' === ADMIN_CHECK_SECRET
export async function GET(req: Request) {
  try {
    const secret = req.headers.get("x-admin-check") || "";
    const expected = process.env.ADMIN_CHECK_SECRET || "";
    const isDryRun = String(process.env.WA_DRY_RUN || "").toLowerCase() === 'true';
    // Allow bypass in local dry-run mode for quick diagnostics
    if (!isDryRun) {
      if (!expected) {
        return NextResponse.json({ ok: false, error: "ADMIN_CHECK_SECRET_NOT_SET" }, { status: 403 });
      }
      if (secret !== expected) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
      }
    }

    const tables = [
      "Attendant",
      "LoginCode",
      "Session",
      "Setting",
      "WaMessageLog",
      "Outlet",
    ];

    const result: Record<string, boolean> = {};
    for (const t of tables) {
      try {
        // safe because table names are hard-coded above
        const rows: any = await (prisma as any).$queryRawUnsafe(`SELECT to_regclass('public."${t}"') as name`);
        const exists = Array.isArray(rows) && rows.length > 0 && rows[0]?.name !== null;
        result[t] = Boolean(exists);
      } catch (e) {
        result[t] = false;
      }
    }

    // Also test DB connectivity with a lightweight query
    let dbOk = true;
    let dbError: string | null = null;
    try {
      await (prisma as any).$queryRaw`SELECT 1`;
    } catch (e: any) {
      dbOk = false;
      dbError = String(e?.message || e);
    }

    return NextResponse.json({ ok: true, dbOk, dbError, tables: result });
  } catch (e: any) {
    console.error("admin db check failed", e);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) }, { status: 500 });
  }
}
