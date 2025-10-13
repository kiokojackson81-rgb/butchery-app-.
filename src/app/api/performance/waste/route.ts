// src/app/api/performance/waste/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = String(searchParams.get("date") || "").slice(0, 10);
    const outletName = String(searchParams.get("outlet") || "").trim();
    if (!date) return NextResponse.json({ ok: false, error: "Missing date" }, { status: 400 });
    const where: any = { date };
    if (outletName) where.outletName = outletName;
    const [rows, pb] = await Promise.all([
      (prisma as any).attendantClosing.findMany({ where }),
      outletName ? (prisma as any).pricebookRow.findMany({ where: { outletName } }) : Promise.resolve([]),
    ]);
    const priceByKey = new Map<string, number>((pb || []).map((r: any) => [r.productKey, Number(r.sellPrice || 0)]));
    const agg = new Map<string, { outletName: string; productKey: string; wasteQty: number; wasteValue: number }>();
    for (const r of rows || []) {
      const k = String((r as any).itemKey);
      const o = String((r as any).outletName);
      const key = `${o}::${k}`;
      const price = priceByKey.get(k) || 0;
      const wasteQty = Number((r as any).wasteQty || 0);
      const cur = agg.get(key) || { outletName: o, productKey: k, wasteQty: 0, wasteValue: 0 };
      cur.wasteQty += wasteQty;
      cur.wasteValue += wasteQty * price;
      agg.set(key, cur);
    }
    const data = Array.from(agg.values());
    return NextResponse.json({ ok: true, rows: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
