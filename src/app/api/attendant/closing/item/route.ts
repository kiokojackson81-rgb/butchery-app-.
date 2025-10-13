import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const sess = await getSession();
    if (!sess) return NextResponse.json({ ok: false }, { status: 401 });
    const outletName = (sess as any).attendant?.outletRef?.name || (sess as any).outletCode || "";
    if (!outletName) return NextResponse.json({ ok: false, error: "No outlet" }, { status: 400 });
    const date = new Date().toISOString().slice(0, 10);

    const { itemKey, closingQty, wasteQty } = (await req.json()) as { itemKey?: string; closingQty?: number; wasteQty?: number };
    const key = (itemKey || "").trim();
    if (!key) return NextResponse.json({ ok: false, error: "itemKey required" }, { status: 400 });
    const closing = Number.isFinite(Number(closingQty)) ? Math.max(0, Number(closingQty)) : 0;
    const waste = Number.isFinite(Number(wasteQty)) ? Math.max(0, Number(wasteQty)) : 0;

      // Validate against opening-effective (yesterday closing + today's supply)
      try {
        const dt = new Date(date + "T00:00:00.000Z"); dt.setUTCDate(dt.getUTCDate() - 1);
        const y = dt.toISOString().slice(0,10);
        const [prev, supply] = await Promise.all([
          (prisma as any).attendantClosing.findFirst({ where: { date: y, outletName, itemKey: key } }),
          (prisma as any).supplyOpeningRow.findFirst({ where: { date, outletName, itemKey: key } }),
        ]);
        const openEff = Number((prev?.closingQty || 0)) + Number((supply?.qty || 0));
        const maxClosing = Math.max(0, openEff - waste);
        if (closing > maxClosing + 1e-6) {
          return NextResponse.json({ ok: false, error: `Invalid closing for ${key}: ${closing} exceeds available ${maxClosing} (OpeningEff ${openEff} - Waste ${waste}).` }, { status: 400 });
        }
      } catch {}

    await (prisma as any).attendantClosing.upsert({
      where: { date_outletName_itemKey: { date, outletName, itemKey: key } },
      create: { date, outletName, itemKey: key, closingQty: closing, wasteQty: waste },
      update: { closingQty: closing, wasteQty: waste },
    });

  return NextResponse.json({ ok: true, itemKey: key, closingQty: closing, wasteQty: waste });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
