import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

/* Admin supply edit endpoint
   POST /api/admin/supply/edit-item
   Body: { date, outlet, itemKey, qty?, buyPrice?, unit?, unlock?: boolean, delete?: boolean }
   - Requires header x-admin-auth === 'true'
   - Supports legacy DB without lockedAt/lockedBy columns.
   - If delete=true deletes the row regardless of locked state.
   - If unlock=true clears lockedAt/lockedBy (when columns exist).
   - If qty/buyPrice/unit provided, upserts the row (overwriting qty/buyPrice/unit) regardless of locked.
   Audit: stores before/after in Setting key: admin_edit:<ts>:supply:<date>:<outlet>:<itemKey>
*/

let HAS_LOCK_COLS: boolean | null = null;
async function detectLockCols() {
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
    const adminHeader = req.headers.get('x-admin-auth');
    if (adminHeader !== 'true') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    const body = await req.json().catch(()=>({})) as any;
    const date = String(body.date || '').slice(0,10);
    const outlet = String(body.outlet || '').trim();
    const itemKey = String(body.itemKey || '').trim();
    const qtyNum = Number(body.qty);
    const buyPriceNum = Number(body.buyPrice);
    const unit = body.unit === 'pcs' ? 'pcs' : (body.unit === 'kg' ? 'kg' : undefined);
    const unlock = body.unlock === true;
    const del = body.delete === true;
    if (!date || !outlet || !itemKey) return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });

    const hasLockCols = await detectLockCols();
    let before: any = null;
    try {
      before = await (prisma as any).supplyOpeningRow.findUnique({ where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } } });
    } catch {}

    if (del) {
      if (before) {
        try { await (prisma as any).supplyOpeningRow.delete({ where: { id: before.id } }); } catch {}
        try {
          const key = `admin_edit:${Date.now()}:supply:${date}:${outlet}:${itemKey}`;
          await (prisma as any).setting.create({ data: { key, value: { type: 'supply_item_delete', date, outlet, itemKey, before, after: null, by: 'admin_portal', at: new Date().toISOString() } } });
        } catch {}
        return NextResponse.json({ ok: true, deleted: true });
      } else {
        return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
      }
    }

    // Validate product if creating or updating
    if (!before || qtyNum || buyPriceNum || unit) {
      try {
        const prod = await (prisma as any).product.findUnique({ where: { key: itemKey } });
        if (!prod) return NextResponse.json({ ok: false, error: 'invalid product' }, { status: 400 });
        if (unit && prod.unit !== unit) return NextResponse.json({ ok: false, error: 'unit mismatch' }, { status: 400 });
      } catch {}
    }

    let after: any = before;

    // Upsert path (qty/buyPrice/unit modifications) – allow overriding locked rows.
    const wantsUpdate = Number.isFinite(qtyNum) || Number.isFinite(buyPriceNum) || unit != null;
    if (wantsUpdate) {
      const data: any = {};
      if (Number.isFinite(qtyNum)) data.qty = qtyNum;
      if (Number.isFinite(buyPriceNum)) data.buyPrice = buyPriceNum;
      if (unit) data.unit = unit;
      if (hasLockCols) {
        if (unlock) { data.lockedAt = null; data.lockedBy = null; }
        after = await (prisma as any).supplyOpeningRow.upsert({
          where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } },
          update: data,
          create: { date, outletName: outlet, itemKey, qty: data.qty ?? 0, buyPrice: data.buyPrice ?? 0, unit: data.unit ?? 'kg', lockedAt: unlock ? null : new Date(), lockedBy: unlock ? null : 'admin_portal' },
        });
      } else {
        after = await (prisma as any).supplyOpeningRow.upsert({
          where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } },
          update: data,
          create: { date, outletName: outlet, itemKey, qty: data.qty ?? 0, buyPrice: data.buyPrice ?? 0, unit: data.unit ?? 'kg' },
        });
      }
    } else if (unlock && hasLockCols && before) {
      // Unlock only
      after = await (prisma as any).supplyOpeningRow.update({ where: { id: before.id }, data: { lockedAt: null, lockedBy: null } });
    }

    try {
      const key = `admin_edit:${Date.now()}:supply:${date}:${outlet}:${itemKey}`;
      await (prisma as any).setting.create({ data: { key, value: { type: 'supply_item', date, outlet, itemKey, action: del ? 'delete' : (unlock ? 'unlock' : 'edit'), before, after, by: 'admin_portal', at: new Date().toISOString() } } });
    } catch {}

    return NextResponse.json({ ok: true, row: after, legacyNoLock: hasLockCols === false });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server' }, { status: 500 });
  }
}
