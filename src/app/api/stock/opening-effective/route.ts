import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

function prevDateISO(d: string) {
  const dt = new Date(d + "T00:00:00.000Z");
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").slice(0, 10);
    const outlet = (searchParams.get("outlet") || "").trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });

    const [supplyRows, productRows] = await Promise.all([
      (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet } }),
      (prisma as any).product.findMany(),
    ]);

    const unitByKey: Record<string, string> = {};
    for (const p of productRows || []) unitByKey[(p as any).key] = (p as any).unit || "kg";

    // If there's no explicit opening supply rows, fall back to yesterday's closings as opening.
    let effectiveMap = new Map<string, number>();
    if (!supplyRows || supplyRows.length === 0) {
      const y = prevDateISO(date);
      const prevClosing = await (prisma as any).attendantClosing.findMany({ where: { date: y, outletName: outlet } });
      for (const r of prevClosing || []) {
        const key = (r as any).itemKey;
        const qty = Number((r as any).closingQty || 0);
        if (!Number.isFinite(qty)) continue;
        effectiveMap.set(key, (effectiveMap.get(key) || 0) + qty);
      }
    }

    // Add today's opening supply on top (concept: opening = yesterday closing + today's supply)
    for (const r of supplyRows || []) {
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
