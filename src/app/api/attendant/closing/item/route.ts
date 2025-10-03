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
