import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";

// GET /api/pricebook/outlet?outlet=Bright&activeOnly=true
// Response: { ok, outlet, products: [{ key, name, price, active }] }
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const outlet = (url.searchParams.get("outlet") || "").trim();
    const activeOnly = (url.searchParams.get("activeOnly") || "true").toLowerCase() !== "false";
    if (!outlet) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

    const rows = await (prisma as any).pricebookRow.findMany({
      where: { outletName: outlet },
      select: { productKey: true, sellPrice: true, active: true },
    });
    const keys = Array.from(new Set(rows.map((r: any) => String(r.productKey))));
    const prods = await (prisma as any).product.findMany({ where: { key: { in: keys } }, select: { key: true, name: true } });
    const nameByKey = new Map<string, string>(prods.map((p: any) => [String(p.key), String(p.name || p.key)] as const));

    const products = rows
      .filter((r: any) => (activeOnly ? !!r.active : true))
      .map((r: any) => ({ key: String(r.productKey), name: nameByKey.get(String(r.productKey)) || String(r.productKey), price: Number(r.sellPrice || 0), active: !!r.active }));

    return NextResponse.json({ ok: true, outlet, products });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
