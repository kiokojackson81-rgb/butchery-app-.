import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getCloseCount, incrementCloseCount, APP_TZ, addDaysISO, dateISOInTZ } from "@/server/trading_period";

export async function POST(req: Request) {
  const { outlet, openingSnapshot, pricebookSnapshot } = (await req.json()) as {
    outlet: string;
    openingSnapshot: Record<string, number>;
    pricebookSnapshot: Record<string, { sellPrice: number; active: boolean }>;
  };
  if (!outlet) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

  const tz = APP_TZ;
  const date = dateISOInTZ(new Date(), tz);
  const tomorrow = addDaysISO(date, 1, tz);

  // Enforce max 2 closes per calendar day per outlet
  const currentCount = await getCloseCount(outlet, date).catch(() => 0);
  if (currentCount >= 2) {
    return NextResponse.json({ ok: false, error: `Max closes reached for ${outlet} on ${date}.` }, { status: 409 });
  }

  const nextCount = await incrementCloseCount(outlet, date).catch(() => currentCount + 1);

  await prisma.$transaction(async (tx) => {
    // Seed tomorrow's opening rows using: next = max(0, yesterdayClosing + todaySupply - todayClosing - todayWaste)
    try {
      // Build prevOpen from yesterday's closing
  const y = addDaysISO(date, -1, tz);
      const [prevClosings, todaySupplyRows, todaysClosings] = await Promise.all([
        (tx as any).attendantClosing.findMany({ where: { date: y, outletName: outlet } }),
        (tx as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet } }),
        (tx as any).attendantClosing.findMany({ where: { date, outletName: outlet } }),
      ]);

      const prevOpenByItem: Record<string, number> = {};
      for (const r of prevClosings || []) {
        const k = String((r as any).itemKey);
        const qty = Number((r as any).closingQty || 0);
        if (!Number.isFinite(qty)) continue;
        prevOpenByItem[k] = (prevOpenByItem[k] || 0) + qty;
      }

      const supplyByItem: Record<string, number> = {};
      for (const r of todaySupplyRows || []) {
        const k = String((r as any).itemKey);
        const qty = Number((r as any).qty || 0);
        if (!Number.isFinite(qty)) continue;
        supplyByItem[k] = (supplyByItem[k] || 0) + qty;
      }

      const closingByItem: Record<string, { closingQty: number; wasteQty: number }> = {};
      for (const r of todaysClosings || []) {
        const k = String((r as any).itemKey);
        closingByItem[k] = {
          closingQty: Number((r as any).closingQty || 0),
          wasteQty: Number((r as any).wasteQty || 0),
        };
      }

      // Period rotation behavior:
      // - After first close of the day (nextCount === 1): reset TODAY's opening rows to the new base (prev + supply - close - waste).
      //   This starts a new period on the same calendar day with supply effectively zeroed relative to the new base.
      // - After second close (nextCount >= 2): seed TOMORROW's opening rows for the next day.
      const keys = new Set<string>([
        ...Object.keys(prevOpenByItem),
        ...Object.keys(supplyByItem),
        ...Object.keys(closingByItem),
      ]);
      if (nextCount === 1) {
        await (tx as any).supplyOpeningRow.deleteMany({ where: { date, outletName: outlet } });
        const dataToday: Array<{ date: string; outletName: string; itemKey: string; qty: number }> = [];
        for (const key of keys) {
          const base = Number(prevOpenByItem[key] || 0);
          const add = Number(supplyByItem[key] || 0);
          const close = Number((closingByItem[key]?.closingQty) || 0);
          const waste = Number((closingByItem[key]?.wasteQty) || 0);
          const nextQty = Math.max(0, base + add - close - waste);
          if (nextQty > 0) dataToday.push({ date, outletName: outlet, itemKey: key, qty: nextQty });
        }
        if (dataToday.length > 0) {
          await (tx as any).supplyOpeningRow.createMany({ data: dataToday });
        }
      } else if (nextCount >= 2) {
        await (tx as any).supplyOpeningRow.deleteMany({ where: { date: tomorrow, outletName: outlet } });
        const dataTomorrow: Array<{ date: string; outletName: string; itemKey: string; qty: number }> = [];
        for (const key of keys) {
          const base = Number(prevOpenByItem[key] || 0);
          const add = Number(supplyByItem[key] || 0);
          const close = Number((closingByItem[key]?.closingQty) || 0);
          const waste = Number((closingByItem[key]?.wasteQty) || 0);
          const nextQty = Math.max(0, base + add - close - waste);
          if (nextQty > 0) dataTomorrow.push({ date: tomorrow, outletName: outlet, itemKey: key, qty: nextQty });
        }
        if (dataTomorrow.length > 0) {
          await (tx as any).supplyOpeningRow.createMany({ data: dataTomorrow });
        }
      }
    } catch {}

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

  // No calendar-day locking: multiple periods allowed per day (max 2). Return current close count.
  return NextResponse.json({ ok: true, closeCount: nextCount });
}
