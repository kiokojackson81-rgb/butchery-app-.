import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const { outlet, openingSnapshot, pricebookSnapshot } = (await req.json()) as {
    outlet: string;
    openingSnapshot: Record<string, number>;
    pricebookSnapshot: Record<string, { sellPrice: number; active: boolean }>;
  };
  if (!outlet) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

  const date = new Date().toISOString().slice(0, 10);

  await prisma.$transaction(async (tx) => {
    // Do NOT pre-populate today's supply rows on period start.
    // New trading day begins with supply empty, and opening-effective will derive
    // opening from yesterday's closing plus any new supply posted today.

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
