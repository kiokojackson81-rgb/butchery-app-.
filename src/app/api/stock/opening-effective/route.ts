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

    const [openingRows, productRows, prevClosing] = await Promise.all([
      // Select only legacy-safe columns to avoid errors on DBs missing new fields (lockedAt/lockedBy)
      (prisma as any).supplyOpeningRow.findMany({
        where: { date, outletName: outlet },
        select: { itemKey: true, qty: true, unit: true },
      }),
      (prisma as any).product.findMany(),
      (prisma as any).attendantClosing.findMany({ where: { date: prevDateISO(date), outletName: outlet } }),
    ]);

    const unitByKey: Record<string, string> = {};
    for (const p of productRows || []) unitByKey[(p as any).key] = (p as any).unit || "kg";

    // Prefer explicit opening rows (authoritative after a period rotation). If none exist,
    // compute OpeningEff = yesterday closing + today's supply rows.
    const effectiveMap = new Map<string, number>();
    if (openingRows && openingRows.length > 0) {
      for (const r of openingRows || []) {
        const key = (r as any).itemKey;
        const qty = Number((r as any).qty || 0);
        if (!Number.isFinite(qty)) continue;
        effectiveMap.set(key, (effectiveMap.get(key) || 0) + qty);
      }
    } else {
      for (const r of prevClosing || []) {
        const key = (r as any).itemKey;
        const qty = Number((r as any).closingQty || 0);
        if (!Number.isFinite(qty)) continue;
        effectiveMap.set(key, (effectiveMap.get(key) || 0) + qty);
      }
      const todaySupplyRows = openingRows || [];
      for (const r of todaySupplyRows || []) {
        const key = (r as any).itemKey;
        const qty = Number((r as any).qty || 0);
        if (!Number.isFinite(qty)) continue;
        effectiveMap.set(key, (effectiveMap.get(key) || 0) + qty);
      }
    }

    const rows = Array.from(effectiveMap.entries()).map(([itemKey, qty]) => ({ itemKey, qty, unit: unitByKey[itemKey] || "kg" }));
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
