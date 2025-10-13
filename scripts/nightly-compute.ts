// scripts/nightly-compute.ts
import { computeAllOutletsPerformance } from "@/lib/analytics/performance.service";
import { prisma } from "@/lib/prisma";
import { computeAllAttendantKPIs } from "@/lib/analytics/attendant-kpi.service";
import { buildDailyProductSupplyStats, computeSupplyRecommendations } from "@/lib/analytics/supply-insights.service";
import { nightlyRecalcOpenIntervals, closeOpenSupplyIntervalsIfNeeded } from "@/lib/analytics/intervals.service";

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

async function main() {
  const date = process.env.DATE?.slice(0, 10) || todayISO();
  const outlet = process.env.OUTLET?.trim();
  if (outlet) {
    await computeAllOutletsPerformance(date); // includes outlet
    await computeAllAttendantKPIs(date, outlet);
    await buildDailyProductSupplyStats(date, outlet);
    await computeSupplyRecommendations(date, outlet);
  } else {
    await computeAllOutletsPerformance(date);
    const outlets = await (prisma as any).outlet.findMany({ where: { active: true }, select: { name: true } });
    for (const o of outlets || []) {
      const name = (o as any).name as string;
      await computeAllAttendantKPIs(date, name);
      await buildDailyProductSupplyStats(date, name);
      await computeSupplyRecommendations(date, name);
    }
  }
  await nightlyRecalcOpenIntervals(date);
  await closeOpenSupplyIntervalsIfNeeded(date);
  console.log(`Nightly compute completed for ${date}${outlet ? ` (${outlet})` : ''}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
