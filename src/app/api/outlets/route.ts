import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

function normCode(raw: string) {
  return (raw || "").trim();
}
function normName(raw: string) {
  return (raw || "").trim();
}

// GET /api/outlets?active=true|false (default true)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const activeParam = searchParams.get("active");
    const onlyActive = activeParam ? /^true$/i.test(activeParam) : true;
    const where: any = {};
    if (onlyActive) where.active = true;
    const rows = await (prisma as any).outlet.findMany({
      where,
      select: { id: true, name: true, code: true, active: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}

// POST /api/outlets
// Body: { name: string; code?: string; active?: boolean }
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = normName(String(body?.name || ""));
    const code = normCode(String(body?.code || "")) || null;
    const active = typeof body?.active === "boolean" ? !!body.active : true;
    if (!name) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });

    // Choose unique selector: prefer code when provided; else name (unique in schema)
    let outlet: any;
    if (code) {
      outlet = await (prisma as any).outlet.upsert({
        where: { code },
        update: { name, active },
        create: { name, code, active },
      });
    } else {
      outlet = await (prisma as any).outlet.upsert({
        where: { name },
        update: { active },
        create: { name, active },
      });
    }

    // Read back the saved entity to confirm persistence
    const saved = await (prisma as any).outlet.findUnique({ where: { id: outlet.id }, select: { id: true, name: true, code: true, active: true } });
    return NextResponse.json({ ok: true, outlet: saved });
  } catch (e: any) {
    let msg = e?.message || "Failed";
    if (/Unique constraint|already exists/i.test(msg)) {
      return NextResponse.json({ ok: false, error: "conflict" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
