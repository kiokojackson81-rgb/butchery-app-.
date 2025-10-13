// src/lib/analytics/intervals.service.ts
import { prisma } from "@/lib/prisma";

type DayKey = string; // YYYY-MM-DD

export async function onSupplyPosted(date: DayKey, outletName: string, productKey: string, supplyId: string, suppliedQty: number) {
  // Close any open interval for this outlet/product by setting endedAt and computing placeholder metrics
  const open = await (prisma as any).supplyIntervalPerformance.findFirst({ where: { outletName, productKey, endSupplyId: null } });
  if (open) {
    const endTotals = await (prisma as any).productSupplyStat.findUnique({ where: { date_outletName_productKey: { date, outletName, productKey } } });
    const closingQty = Number(endTotals?.closingQty || 0);
    const salesQty = Number(endTotals?.salesQty || 0);
    const wasteQty = Number(endTotals?.wasteQty || 0);
    const revenue = 0; const costOfGoods = 0; const grossProfit = revenue - costOfGoods; const gpPct = revenue > 0 ? grossProfit / revenue : 0;
    await (prisma as any).supplyIntervalPerformance.update({
      where: { id: (open as any).id },
      data: { endedAt: new Date(), endSupplyId: supplyId, salesQty, wasteQty, closingQty, revenue, costOfGoods, grossProfit, gpPct },
    });
  }
  // Start new interval
  await (prisma as any).supplyIntervalPerformance.create({
    data: {
      outletName,
      productKey,
      startSupplyId: supplyId,
      startedAt: new Date(),
      openingQty: suppliedQty,
      addlSupplyQty: 0,
    },
  });
  // Link current interval on daily stat for convenience
  await (prisma as any).productSupplyStat.upsert({
    where: { date_outletName_productKey: { date, outletName, productKey } },
    update: { currentIntervalId: supplyId, intervalDayIndex: 0 },
    create: { date, outletName, productKey, salesQty: 0, wasteQty: 0, openingQty: suppliedQty, supplyQty: suppliedQty, closingQty: suppliedQty, currentIntervalId: supplyId, intervalDayIndex: 0 },
  });
}

export async function nightlyRecalcOpenIntervals(date: DayKey) {
  const open = await (prisma as any).supplyIntervalPerformance.findMany({ where: { endSupplyId: null } });
  for (const it of open) {
    const outletName = (it as any).outletName; const productKey = (it as any).productKey;
    const stat = await (prisma as any).productSupplyStat.findUnique({ where: { date_outletName_productKey: { date, outletName, productKey } } });
    if (!stat) continue;
    const days = await (prisma as any).productSupplyStat.count({ where: { outletName, productKey } });
    const avgDailyVelocity = days > 0 ? Number((stat as any).salesQty || 0) / Math.max(1, days) : 0;
    await (prisma as any).supplyIntervalPerformance.update({ where: { id: (it as any).id }, data: { salesQty: Number(stat.salesQty || 0), wasteQty: Number(stat.wasteQty || 0), closingQty: Number(stat.closingQty || 0), avgDailyVelocity, sellThroughPct: computeSellThrough(stat) } });
  }
}

function computeSellThrough(stat: any) { const open = Number(stat?.openingQty || 0) + Number(stat?.supplyQty || 0); const sold = Number(stat?.salesQty || 0); return open > 0 ? sold / open : 0; }

export async function markStockoutIfAny(date: DayKey, outletName: string, productKey: string) {
  const stat = await (prisma as any).productSupplyStat.findUnique({ where: { date_outletName_productKey: { date, outletName, productKey } } });
  if (!stat) return;
  if (Number((stat as any).closingQty || 0) <= 0) {
    const open = await (prisma as any).supplyIntervalPerformance.findFirst({ where: { outletName, productKey, endSupplyId: null } });
    if (open) await (prisma as any).supplyIntervalPerformance.update({ where: { id: (open as any).id }, data: { stockoutEvents: Number((open as any).stockoutEvents || 0) + 1 } });
  }
}

export async function closeOpenSupplyIntervalsIfNeeded(_date: DayKey) {
  // Policy placeholder: no-op. Can enforce closure after N days without activity.
  return { ok: true } as const;
}
