import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { APP_TZ, addDaysISO, dateISOInTZ } from "@/server/trading_period";

function prevDateISO(d: string) {
  return addDaysISO(d, -1, APP_TZ);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
  const tz = APP_TZ;
  const date = ((searchParams.get("date") || "").slice(0, 10)) || dateISOInTZ(new Date(), tz);
    const outlet = (searchParams.get("outlet") || "").trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });

    // Try to read lockedAt to distinguish seeded base rows from supplier-delivery rows.
    // If lockedAt column does not exist (legacy DB), fall back to previous logic.
    let openingRows: Array<{ itemKey: string; qty: number; unit?: string; lockedAt?: Date | null }> = [];
    const [productRows, prevClosing] = await Promise.all([
      (prisma as any).product.findMany(),
      (prisma as any).attendantClosing.findMany({ where: { date: prevDateISO(date), outletName: outlet } }),
    ]);
    let hasLockCols = true;
    try {
      const rows = await (prisma as any).supplyOpeningRow.findMany({
        where: { date, outletName: outlet },
        select: { itemKey: true, qty: true, unit: true, lockedAt: true },
      });
      openingRows = rows as any;
    } catch (e: any) {
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('lockedat') && msg.includes('does not exist')) {
        hasLockCols = false;
        const rows = await (prisma as any).supplyOpeningRow.findMany({
          where: { date, outletName: outlet },
          select: { itemKey: true, qty: true, unit: true },
        });
        openingRows = rows as any;
      } else {
        throw e;
      }
    }

    const unitByKey: Record<string, string> = {};
    for (const p of productRows || []) unitByKey[(p as any).key] = (p as any).unit || "kg";

    // Compute OpeningEff with rotation-awareness:
    // - If seeded base rows exist (lockedAt is null), use their sum as base.
    // - Otherwise, base = yesterday's closing.
    // - Always add supplier-delivery rows (lockedAt non-null when lock cols exist).
    const baseMap = new Map<string, number>();
    const addlMap = new Map<string, number>();
    if (openingRows && openingRows.length > 0 && hasLockCols) {
      // Split seeded vs deliveries using lockedAt null heuristic
      for (const r of openingRows) {
        const key = (r as any).itemKey;
        const qty = Number((r as any).qty || 0);
        if (!Number.isFinite(qty)) continue;
        const isSeed = (r as any)?.lockedAt == null;
        const map = isSeed ? baseMap : addlMap;
        map.set(key, (map.get(key) || 0) + qty);
      }
    } else if (openingRows && openingRows.length > 0 && !hasLockCols) {
      // Legacy: cannot distinguish; treat all as deliveries added to base from prev closing
      for (const r of openingRows) {
        const key = (r as any).itemKey;
        const qty = Number((r as any).qty || 0);
        if (!Number.isFinite(qty)) continue;
        addlMap.set(key, (addlMap.get(key) || 0) + qty);
      }
    }

    // If no seeded base rows, use yesterday's closing as base
    if (baseMap.size === 0) {
      for (const r of prevClosing || []) {
        const key = (r as any).itemKey;
        const qty = Number((r as any).closingQty || 0);
        if (!Number.isFinite(qty)) continue;
        baseMap.set(key, (baseMap.get(key) || 0) + qty);
      }
    }

    // effective = base + additional deliveries
    const effectiveMap = new Map<string, number>();
    for (const [k, v] of baseMap.entries()) effectiveMap.set(k, v);
    for (const [k, v] of addlMap.entries()) effectiveMap.set(k, (effectiveMap.get(k) || 0) + v);

    const rows = Array.from(effectiveMap.entries()).map(([itemKey, qty]) => ({ itemKey, qty, unit: unitByKey[itemKey] || "kg" }));
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
