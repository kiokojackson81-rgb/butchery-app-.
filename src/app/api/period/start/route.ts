import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const { outlet, openingSnapshot, pricebookSnapshot } = (await req.json()) as {
    outlet: string;
    openingSnapshot: Record<string, number>;
    pricebookSnapshot: Record<string, { sellPrice: number; active: boolean }>;
  };
  if (!outlet) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

  const date = new Date().toISOString().slice(0, 10);

  await prisma.$transaction(async (tx) => {
    // Upsert opening rows (qty only; buyPrice remains 0 unless supplier provided earlier)
    const products = await tx.product.findMany();
    const unitByKey = Object.fromEntries(products.map((p) => [p.key, p.unit]));

    for (const [itemKey, qty] of Object.entries(openingSnapshot || {})) {
      await tx.supplyOpeningRow.upsert({
        where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } },
        create: { date, outletName: outlet, itemKey, qty: Number(qty || 0), unit: (unitByKey as any)[itemKey] || "kg", buyPrice: 0 },
        update: { qty: Number(qty || 0) },
      });
    }

    // Upsert pricebook snapshot
    for (const [itemKey, row] of Object.entries(pricebookSnapshot || {})) {
      await tx.pricebookRow.upsert({
        where: { outletName_productKey: { outletName: outlet, productKey: itemKey } },
        create: { outletName: outlet, productKey: itemKey, sellPrice: Number((row as any).sellPrice || 0), active: !!(row as any).active },
        update: { sellPrice: Number((row as any).sellPrice || 0), active: !!(row as any).active },
      });
    }

    // Active period
    await tx.activePeriod.upsert({
      where: { outletName: outlet },
      create: { outletName: outlet, periodStartAt: new Date() },
      update: { periodStartAt: new Date() },
    });
  });

  return NextResponse.json({ ok: true });
}
