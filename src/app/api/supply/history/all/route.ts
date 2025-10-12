import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";

type SortKey = "date_asc" | "date_desc" | "outlet_asc" | "outlet_desc" | "name_asc" | "name_desc";

function todayISO() { return new Date().toISOString().slice(0, 10); }
function dateNDaysAgoISO(days: number) { const d = new Date(); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); }

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const days = Math.max(1, Math.min(31, Number(searchParams.get("days") || 7)));
    const from = (searchParams.get("from") || dateNDaysAgoISO(days - 1)).slice(0, 10);
    const to = (searchParams.get("to") || todayISO()).slice(0, 10);
    const outlet = (searchParams.get("outlet") || "").trim();
    const sort = (searchParams.get("sort") || "date_desc").toLowerCase() as SortKey;
    const limit = Math.max(1, Math.min(1000, Number(searchParams.get("limit") || 200)));
    const offset = Math.max(0, Number(searchParams.get("offset") || 0));

    const where: any = { date: { gte: from, lte: to } };
    if (outlet) where.outletName = outlet;

    const baseRows = await (prisma as any).supplyOpeningRow.findMany({ where, skip: offset, take: limit });
    if (!Array.isArray(baseRows) || baseRows.length === 0) {
      return NextResponse.json({ ok: true, rows: [], count: 0 });
    }

    // Gather enrichment keys
    const keys = Array.from(new Set(baseRows.map((r: any) => r.itemKey).filter(Boolean)));
    const outlets = Array.from(new Set(baseRows.map((r: any) => r.outletName).filter(Boolean)));

    const [products, pricebook] = await Promise.all([
      keys.length ? (prisma as any).product.findMany({ where: { key: { in: keys } }, select: { key: true, name: true, unit: true, sellPrice: true } }) : [],
      outlets.length && keys.length
        ? (prisma as any).pricebookRow.findMany({ where: { outletName: { in: outlets }, productKey: { in: keys } }, select: { outletName: true, productKey: true, sellPrice: true, active: true } })
        : [],
    ]);

    const nameByKey = new Map<string, string>();
    const unitByKey = new Map<string, string>();
    for (const p of products as any[]) {
      if (!p?.key) continue;
      nameByKey.set(p.key, String(p.name || p.key));
      unitByKey.set(p.key, String(p.unit || "kg"));
    }
    const sellByOutletKey = new Map<string, number>(); // `${outlet}|${key}` -> sellPrice
    for (const r of pricebook as any[]) {
      if (!r?.productKey || !r?.outletName) continue;
      if (r.active === false) continue;
      sellByOutletKey.set(`${r.outletName}|${r.productKey}`, Number(r.sellPrice || 0));
    }

    type Row = {
      date: string;
      outlet: string;
      itemKey: string;
      name: string;
      qty: number;
      unit: string;
      buyPrice: number; // per unit
      sellPrice?: number; // per unit (from pricebook)
      totalBuy?: number;
      totalSell?: number;
      marginKsh?: number;
    };

    let list: Row[] = (baseRows as any[]).map((r) => {
      const name = nameByKey.get(r.itemKey) || r.itemKey;
      const unit = String(r.unit || unitByKey.get(r.itemKey) || "kg");
      const qty = Number(r.qty || 0);
      const buy = Number(r.buyPrice || 0);
      const sell = sellByOutletKey.get(`${r.outletName}|${r.itemKey}`) ?? undefined;
      const totalBuy = qty * buy;
      const totalSell = sell != null ? qty * sell : undefined;
      const marginKsh = sell != null ? (qty * (sell - buy)) : undefined;
      return { date: r.date, outlet: r.outletName, itemKey: r.itemKey, name, qty, unit, buyPrice: buy, sellPrice: sell, totalBuy, totalSell, marginKsh };
    });

    // Sorting
    list.sort((a, b) => {
      switch (sort) {
        case "date_asc": return a.date.localeCompare(b.date) || a.outlet.localeCompare(b.outlet) || a.name.localeCompare(b.name);
        case "name_asc": return a.name.localeCompare(b.name) || b.date.localeCompare(a.date);
        case "name_desc": return b.name.localeCompare(a.name) || b.date.localeCompare(a.date);
        case "outlet_asc": return a.outlet.localeCompare(b.outlet) || b.date.localeCompare(a.date);
        case "outlet_desc": return b.outlet.localeCompare(a.outlet) || b.date.localeCompare(a.date);
        case "date_desc":
        default: return b.date.localeCompare(a.date) || a.outlet.localeCompare(b.outlet) || a.name.localeCompare(b.name);
      }
    });

    return NextResponse.json({ ok: true, rows: list, count: list.length, range: { from, to } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
