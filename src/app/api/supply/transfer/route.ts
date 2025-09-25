import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const { date, fromOutletName, toOutletName, itemKey, qty, unit } = (await req.json()) as {
    date: string;
    fromOutletName: string;
    toOutletName: string;
    itemKey: string;
    qty: number;
    unit: "kg" | "pcs";
  };
  if (!date || !fromOutletName || !toOutletName || !itemKey || !qty) {
    return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    // record transfer
    await tx.supplyTransfer.create({ data: { date, fromOutletName, toOutletName, itemKey, qty, unit } });

    // adjust FROM (decrement)
    const from = await tx.supplyOpeningRow.findUnique({
      where: { date_outletName_itemKey: { date, outletName: fromOutletName, itemKey } },
    });
    const fromQty = Math.max(0, (from?.qty || 0) - qty);
    await tx.supplyOpeningRow.upsert({
      where: { date_outletName_itemKey: { date, outletName: fromOutletName, itemKey } },
      create: { date, outletName: fromOutletName, itemKey, qty: fromQty, unit, buyPrice: from?.buyPrice || 0 },
      update: { qty: fromQty },
    });

    // adjust TO (increment)
    const to = await tx.supplyOpeningRow.findUnique({
      where: { date_outletName_itemKey: { date, outletName: toOutletName, itemKey } },
    });
    const toQty = (to?.qty || 0) + qty;
    await tx.supplyOpeningRow.upsert({
      where: { date_outletName_itemKey: { date, outletName: toOutletName, itemKey } },
      create: { date, outletName: toOutletName, itemKey, qty: toQty, unit, buyPrice: to?.buyPrice || 0 },
      update: { qty: toQty },
    });
  });

  return NextResponse.json({ ok: true });
}
