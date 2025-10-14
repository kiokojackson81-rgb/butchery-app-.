// src/lib/analytics/performance.service.ts
import { prisma } from "@/lib/prisma";

type DayKey = string; // YYYY-MM-DD

export async function listDistinctOutlets(): Promise<string[]> {
  const rows = await (prisma as any).outlet.findMany({ where: { active: true }, select: { name: true } });
  return (rows || []).map((r: any) => r.name).filter(Boolean);
}

export async function computeOutletPerformance(date: DayKey, outletName: string) {
  // Load ledger items
  const [totals, expenses, deposits] = await Promise.all([
    // Reuse existing daily totals used by supervisor summary
    (await import("@/server/finance")).computeDayTotals({ date, outletName }),
    (prisma as any).attendantExpense.findMany({ where: { date, outletName } }),
    (prisma as any).attendantDeposit.findMany({ where: { date, outletName } }),
  ]);

  const expensesSum = (expenses || []).reduce((a: number, e: any) => a + (Number(e.amount) || 0), 0);
  const depositsSum = (deposits || []).filter((d: any) => d.status !== "INVALID").reduce((a: number, d: any) => a + (Number(d.amount) || 0), 0);
  const totalSales = Number((totals as any)?.expectedSales || 0);
  const totalCost = 0; // Not tracked in current schema; future: derive from buyPrice*qty
  const grossProfit = totalSales - totalCost;
  let netProfit = grossProfit - expensesSum;

  // Expected deposit: from computeDayTotals or fallback ratio rules
  let expectedDeposit = Number((totals as any)?.expectedDeposit || 0);
  if (!Number.isFinite(expectedDeposit) || expectedDeposit < 0) expectedDeposit = 0;

  // Waste basis not fully available at cost; approximate from closings wasteQty * sellPrice if needed later
  const wasteCost = 0;
  const wastePct = 0;

  // Compute commissions (sum from attendant KPIs if available)
  let totalCommission = 0;
  try {
    const kpis = await (prisma as any).attendantKPI.findMany({ where: { date, outletName } });
    totalCommission = (kpis || []).reduce((a: number, r: any) => a + (Number(r?.commissionAmount) || 0), 0);
  } catch {}
  netProfit = netProfit - totalCommission;

  // Required deposit is reduced by commissions that attendants keep
  const requiredDeposit = Math.max(0, expectedDeposit - totalCommission);
  const deficit = Math.max(0, requiredDeposit - depositsSum);
  const variancePct = requiredDeposit > 0 ? deficit / requiredDeposit : 0;

  await (prisma as any).outletPerformance.upsert({
    where: { date_outletName: { date, outletName } },
    update: {
      totalSales,
      totalCost,
      grossProfit,
      expenses: expensesSum,
      netProfit,
      deposits: depositsSum,
      expectedDeposit,
      deficit,
      variancePct,
      wasteCost,
      wastePct,
      totalCommission,
    },
    create: {
      date,
      outletName,
      totalSales,
      totalCost,
      grossProfit,
      expenses: expensesSum,
      netProfit,
      deposits: depositsSum,
      expectedDeposit,
      deficit,
      variancePct,
      wasteCost,
      wastePct,
      totalCommission,
    },
  });

  return { ok: true } as const;
}

export async function computeAllOutletsPerformance(date: DayKey) {
  const outlets = await listDistinctOutlets();
  for (const outletName of outlets) {
    await computeOutletPerformance(date, outletName);
  }
  return { ok: true } as const;
}
