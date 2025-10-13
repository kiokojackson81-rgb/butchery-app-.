// src/lib/analytics/insights-engine.ts
// Use minimal local shapes to avoid tight coupling to generated Prisma types
type OutletPerfShape = { netProfit?: number; deficit?: number; expectedDeposit?: number; wastePct?: number };
type AttendantKPIShape = { roiVsSalary?: number; wastePct?: number; depositGap?: number; depositExpected?: number };
type IntervalPerfShape = { stockoutEvents?: number; avgDailyVelocity?: number; sellThroughPct?: number; wasteQty?: number; salesQty?: number };

export function outletFlags(perf: OutletPerfShape, targets: { wastePctMax: number }) {
  const flags: string[] = [];
  if ((perf.netProfit || 0) < 0) flags.push("NEG_NET");
  if ((perf.expectedDeposit || 0) > 0 && (perf.deficit || 0) > 0.1 * (perf.expectedDeposit || 1)) flags.push("LOW_DEPOSIT");
  if ((perf.wastePct || 0) > (targets.wastePctMax || 0.08)) flags.push("HIGH_WASTE");
  return flags;
}

export function attendantFlags(kpi: AttendantKPIShape) {
  const flags: string[] = [];
  if ((kpi.roiVsSalary || 0) < 1.0) flags.push("LOW_ROI_SALARY");
  if ((kpi.wastePct || 0) > 0.08) flags.push("HIGH_PRODUCT_WASTE");
  if ((kpi.depositExpected || 0) > 0 && (kpi.depositGap || 0) > 0.1 * (kpi.depositExpected || 1)) flags.push("LOW_DEPOSIT");
  return flags;
}

export function intervalFlags(interval: IntervalPerfShape, thresholds?: { velocity: number; wasteShare: number }) {
  const flags: string[] = [];
  const velTh = thresholds?.velocity ?? 5;
  const wasteShareTh = thresholds?.wasteShare ?? 0.2;
  const total = (Number(interval.salesQty) || 0) + (Number(interval.wasteQty) || 0);
  const wasteShare = total > 0 ? (Number(interval.wasteQty) || 0) / total : 0;
  if ((interval.stockoutEvents || 0) > 0 && (interval.avgDailyVelocity || 0) > velTh) flags.push("UNDER_SUPPLY");
  if ((interval.sellThroughPct || 0) < 0.4 && wasteShare > wasteShareTh) flags.push("OVER_SUPPLY");
  return flags;
}
