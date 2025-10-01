import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { notifySupplyPosted } from "@/server/supply_notify";

export async function POST(req: Request) {
  try {
    const { date, outlet, supplierCode } = (await req.json().catch(() => ({}))) as {
      date?: string;
      outlet?: string;
      supplierCode?: string | null;
    };
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });

    const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet } });

    await notifySupplyPosted({ outletName: outlet, date, supplierCode: supplierCode || null });

    return NextResponse.json({ ok: true, items: rows.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
