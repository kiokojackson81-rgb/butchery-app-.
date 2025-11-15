import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

/* Unlock a supply day (soft lock stored in Setting key lock:supply:DATE:Outlet)
   POST /api/admin/supply/unlock-day { date, outlet }
   Requires header x-admin-auth === 'true'
   If lock absent returns ok:true (idempotent). Stores audit in Setting.
*/

export async function POST(req: Request) {
  try {
    const h = req.headers.get('x-admin-auth');
    if (h !== 'true') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    const body = await req.json().catch(()=>({})) as any;
    const date = String(body.date || '').slice(0,10);
    const outlet = String(body.outlet || '').trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
    const key = `lock:supply:${date}:${outlet}`;
    const existing = await (prisma as any).setting.findUnique({ where: { key } }).catch(()=>null);
    let before = existing?.value || null;
    if (existing?.value?.locked) {
      try {
        await (prisma as any).setting.upsert({
          where: { key },
          update: { value: { locked: false, unlockedAt: new Date().toISOString(), unlockedBy: 'admin_portal' } },
          create: { key, value: { locked: false, unlockedAt: new Date().toISOString(), unlockedBy: 'admin_portal' } },
        });
      } catch {}
    } else if (!existing) {
      try {
        await (prisma as any).setting.create({ data: { key, value: { locked: false, unlockedAt: new Date().toISOString(), unlockedBy: 'admin_portal' } } });
      } catch {}
    }
    try {
      const auditKey = `admin_edit:${Date.now()}:supply_unlock_day:${date}:${outlet}`;
      const after = { locked: false };
      await (prisma as any).setting.create({ data: { key: auditKey, value: { type: 'supply_day_unlock', date, outlet, before, after, by: 'admin_portal', at: new Date().toISOString() } } });
    } catch {}
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server' }, { status: 500 });
  }
}
