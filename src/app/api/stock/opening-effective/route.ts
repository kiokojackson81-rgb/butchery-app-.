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

    const [todaySupplyRows, productRows, prevClosing] = await Promise.all([
      (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet } }),
      (prisma as any).product.findMany(),
      (prisma as any).attendantClosing.findMany({ where: { date: prevDateISO(date), outletName: outlet } }),
    ]);

    const unitByKey: Record<string, string> = {};
    for (const p of productRows || []) unitByKey[(p as any).key] = (p as any).unit || "kg";

    // Always compute OpeningEff: previous day's closing + today's supply (by product key)
    const effectiveMap = new Map<string, number>();
    for (const r of prevClosing || []) {
      const key = (r as any).itemKey;
      const qty = Number((r as any).closingQty || 0);
      if (!Number.isFinite(qty)) continue;
      effectiveMap.set(key, (effectiveMap.get(key) || 0) + qty);
    }
    for (const r of todaySupplyRows || []) {
      const key = (r as any).itemKey;
      const qty = Number((r as any).qty || 0);
      if (!Number.isFinite(qty)) continue;
      effectiveMap.set(key, (effectiveMap.get(key) || 0) + qty);
    }

    const rows = Array.from(effectiveMap.entries()).map(([itemKey, qty]) => ({ itemKey, qty, unit: unitByKey[itemKey] || "kg" }));
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
