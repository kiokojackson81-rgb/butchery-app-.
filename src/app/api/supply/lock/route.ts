import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";

function normDate(d?: string): string {
  try { const dt = d ? new Date(d) : null; if (!dt) return ""; return dt.toISOString().split("T")[0]; } catch { return ""; }
}
function trim(s?: string): string { return (s || "").trim(); }

export async function POST(req: Request) {
  try {
    const { date, outlet, locked } = await req.json() as { date: string; outlet: string; locked: boolean };
    const dateStr = normDate(date);
    const outletName = trim(outlet);
    const isLocked = !!locked;
    if (!dateStr || !outletName) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "date/outlet required" }, { status: 400 });
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO "OpeningLock" ("date","outletName","locked") VALUES ($1,$2,$3)
       ON CONFLICT ("date","outletName") DO UPDATE SET "locked" = EXCLUDED."locked", "updatedAt" = CURRENT_TIMESTAMP`,
      dateStr, outletName, isLocked
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("/api/supply/lock POST error", err);
    return NextResponse.json({ ok: false, code: "server_error", message: err?.message || "Failed to set lock" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dateStr = normDate(searchParams.get("date") || undefined);
    const outletName = trim(searchParams.get("outlet") || undefined);
    if (!dateStr || !outletName) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "date/outlet required" }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<{ locked: boolean }[]>
      ("SELECT locked FROM \"OpeningLock\" WHERE date=$1 AND \"outletName\"=$2 LIMIT 1", dateStr, outletName);
    const locked = Array.isArray(rows) && rows[0]?.locked === true;
    return NextResponse.json({ ok: true, locked });
  } catch (err: any) {
    console.error("/api/supply/lock GET error", err);
    return NextResponse.json({ ok: false, code: "server_error", message: err?.message || "Failed to get lock" }, { status: 500 });
  }
}
