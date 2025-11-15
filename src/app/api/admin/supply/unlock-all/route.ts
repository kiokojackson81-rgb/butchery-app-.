import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

/* Bulk unlock all item-level supplyOpeningRow locks for a given date/outlet.
   POST /api/admin/supply/unlock-all { date, outlet }
   Requires x-admin-auth === 'true'. Ignores rows without lockedAt.
   Returns { ok, unlockedCount }.
*/

let HAS_LOCK_COLS: boolean | null = null;
async function detectCols() {
  if (HAS_LOCK_COLS != null) return HAS_LOCK_COLS;
  try {
    await (prisma as any).supplyOpeningRow.findMany({ select: { id: true, lockedAt: true }, take: 1 });
    HAS_LOCK_COLS = true;
  } catch (e: any) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('lockedat') && msg.includes('does not exist')) HAS_LOCK_COLS = false; else HAS_LOCK_COLS = true;
  }
  return HAS_LOCK_COLS;
}

export async function POST(req: Request) {
  try {
    const h = req.headers.get('x-admin-auth');
    if (h !== 'true') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    const body = await req.json().catch(()=>({})) as any;
    const date = String(body.date || '').slice(0,10);
    const outlet = String(body.outlet || '').trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
    const hasCols = await detectCols();
    if (!hasCols) return NextResponse.json({ ok: false, error: 'no lock columns present' }, { status: 400 });
    const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet, lockedAt: { not: null } }, select: { id: true } });
    const ids = rows.map((r: any) => r.id);
    let unlockedCount = 0;
    if (ids.length) {
      await prisma.$transaction(async tx => {
        for (const id of ids) {
          await (tx as any).supplyOpeningRow.update({ where: { id }, data: { lockedAt: null, lockedBy: null } });
          unlockedCount += 1;
        }
      });
    }
    try {
      const key = `admin_edit:${Date.now()}:supply_bulk_unlock:${date}:${outlet}`;
      await (prisma as any).setting.create({ data: { key, value: { type: 'supply_bulk_unlock', date, outlet, count: unlockedCount, by: 'admin_portal', at: new Date().toISOString() } } });
    } catch {}
    return NextResponse.json({ ok: true, unlockedCount });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server' }, { status: 500 });
  }
}
