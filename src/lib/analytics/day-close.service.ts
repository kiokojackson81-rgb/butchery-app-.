// src/lib/analytics/day-close.service.ts
import { prisma } from "@/lib/prisma";
import { computeOutletPerformance, computeAllOutletsPerformance } from "./performance.service";
import { computeAllAttendantKPIs } from "./attendant-kpi.service";
import { buildDailyProductSupplyStats, computeSupplyRecommendations } from "./supply-insights.service";
import { nightlyRecalcOpenIntervals, closeOpenSupplyIntervalsIfNeeded } from "./intervals.service";

type DayKey = string; // YYYY-MM-DD

export async function submitDay(outletName: string, businessDate: Date) {
  const date = businessDate.toISOString().slice(0, 10);
  await (prisma as any).dayClosePeriod.upsert({
    where: { outletName_businessDate: { outletName, businessDate: date } },
    update: { status: "SUBMITTED", submittedAt: new Date() },
    create: { outletName, businessDate: date, status: "SUBMITTED", submittedAt: new Date() },
  });
  return { ok: true } as const;
}

export async function lockDay(outletName: string, businessDate: Date, lockedBy: string) {
  const date: DayKey = businessDate.toISOString().slice(0, 10);
  await (prisma as any).dayClosePeriod.upsert({
    where: { outletName_businessDate: { outletName, businessDate: date } },
    update: { status: "LOCKED", lockedAt: new Date(), lockedBy },
    create: { outletName, businessDate: date, status: "LOCKED", lockedAt: new Date(), lockedBy },
  });

  // Compute metrics (idempotent)
  await computeOutletPerformance(date, outletName);
  await computeAllAttendantKPIs(date, outletName);
  await buildDailyProductSupplyStats(date, outletName);
  await computeSupplyRecommendations(date, outletName);
  await nightlyRecalcOpenIntervals(date);
  await closeOpenSupplyIntervalsIfNeeded(date);
  // TODO: broadcast finalised digest via WA (out of scope here)
  return { ok: true } as const;
}
