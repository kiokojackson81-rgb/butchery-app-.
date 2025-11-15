import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

// GET /api/supply/day-lock?date=YYYY-MM-DD&outlet=OutletName
// Returns { ok, locked, lockedAt, by } based on Setting key lock:supply:date:Outlet
// Always responds 200 with ok:true/false; errors produce ok:false + error message.

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get('date') || '').slice(0,10);
    const outlet = (searchParams.get('outlet') || '').trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: 'date/outlet required' }, { status: 400 });
    const key = `lock:supply:${date}:${outlet}`;
    let setting: any = null;
    try { setting = await (prisma as any).setting.findUnique({ where: { key } }); } catch {}
    const locked = Boolean(setting?.value?.locked);
    const lockedAt = locked ? (setting?.value?.lockedAt || null) : null;
    const by = locked ? (setting?.value?.by || null) : null;
    return NextResponse.json({ ok: true, locked, lockedAt, by });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server' }, { status: 500 });
  }
}
