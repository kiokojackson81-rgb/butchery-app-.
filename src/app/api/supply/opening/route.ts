import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";

type RowIn = { itemKey: string; qty: number; buyPrice?: number; unit?: "kg" | "pcs" };

function normDate(d?: string): string {
  try {
    if (!d) return "";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toISOString().split("T")[0];
  } catch {
    return "";
  }
}
function normOutlet(s?: string): string { return (s || "").trim(); }
function normKey(s?: string): string { return (s || "").trim().toLowerCase(); }
function toNum(n: any): number { const v = Number(n); return Number.isFinite(v) ? v : 0; }

export async function POST(req: Request) {
  try {
    const { date, outlet, rows } = (await req.json()) as {
      date: string; outlet: string; rows: Array<RowIn>;
    };
    const dateStr = normDate(date);
    const outletName = normOutlet(outlet);
    if (!dateStr || !outletName) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "date/outlet required" }, { status: 400 });
    }

    const upRows = Array.isArray(rows) ? rows : [];

    const result = await prisma.$transaction(async (tx) => {
      // Product units map for defaulting
      const products = await tx.product.findMany({ select: { key: true, unit: true } });
      const unitByKey: Record<string, string> = Object.fromEntries(products.map((p) => [p.key, p.unit]));

      let upserted = 0;
      for (const r of upRows) {
        const itemKey = normKey(r.itemKey);
        if (!itemKey) continue;
        const qty = toNum(r.qty);
        const buyPrice = toNum(r.buyPrice);
        const unit = (r.unit as string) || unitByKey[itemKey] || "kg";

        await tx.supplyOpeningRow.upsert({
          where: { date_outletName_itemKey: { date: dateStr, outletName, itemKey } },
          create: { date: dateStr, outletName, itemKey, qty, buyPrice, unit },
          update: { qty, buyPrice, unit },
        });
        upserted++;
      }
      return { upserted };
    });

    return NextResponse.json({ ok: true, upserted: result.upserted });
  } catch (err: any) {
    console.error("/api/supply/opening POST error", err);
    return NextResponse.json({ ok: false, code: "server_error", message: err?.message || "Failed to upsert opening" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = normDate(searchParams.get("date") || undefined);
    const outlet = normOutlet(searchParams.get("outlet") || undefined);
    if (!date || !outlet) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "date/outlet required" }, { status: 400 });
    }

    const rows = await prisma.supplyOpeningRow.findMany({
      where: { date, outletName: outlet },
      select: { itemKey: true, qty: true, unit: true, buyPrice: true },
      orderBy: { itemKey: "asc" },
    });

    // minimal and costMap aggregation
    const agg = new Map<string, { qty: number; buyPrice: number; unit: string }>();
    for (const r of rows) {
      const key = normKey(r.itemKey);
      const prev = agg.get(key);
      if (!prev) agg.set(key, { qty: toNum(r.qty), buyPrice: toNum(r.buyPrice), unit: r.unit });
      else agg.set(key, { qty: prev.qty + toNum(r.qty), buyPrice: toNum(r.buyPrice) || prev.buyPrice, unit: r.unit || prev.unit });
    }
    const minimal = Array.from(agg.entries()).map(([itemKey, v]) => ({ itemKey, qty: v.qty }));
    const costMap: Record<string, number> = {};
    for (const [itemKey, v] of agg.entries()) costMap[itemKey] = v.buyPrice || 0;

    return NextResponse.json({ ok: true, rows, minimal, costMap });
  } catch (err: any) {
    console.error("/api/supply/opening GET error", err);
    return NextResponse.json({ ok: false, code: "server_error", message: err?.message || "Failed to fetch opening" }, { status: 500 });
  }
}
