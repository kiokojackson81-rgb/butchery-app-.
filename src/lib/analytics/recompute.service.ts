import { computeOutletPerformance, listDistinctOutlets } from "@/lib/analytics/performance.service";
import { computeAllAttendantKPIs } from "@/lib/analytics/attendant-kpi.service";

export type RecomputeOptions = { date: string; outlet?: string | null; dryRun?: boolean };

export async function recomputeAnalytics(opts: RecomputeOptions) {
  const date = opts.date;
  const startedAt = Date.now();
  const touched: Array<{ outlet: string; outletPerformance: boolean; attendantKPIs: boolean }> = [];
  if (opts.outlet) {
    if (!opts.dryRun) {
      await computeOutletPerformance(date, opts.outlet);
      await computeAllAttendantKPIs(date, opts.outlet);
    }
    touched.push({ outlet: opts.outlet, outletPerformance: true, attendantKPIs: true });
  } else {
    const outlets = await listDistinctOutlets();
    for (const o of outlets) {
      if (!opts.dryRun) {
        await computeOutletPerformance(date, o);
        await computeAllAttendantKPIs(date, o);
      }
      touched.push({ outlet: o, outletPerformance: true, attendantKPIs: true });
    }
  }
  return { ok: true, date, dryRun: !!opts.dryRun, outlets: touched, elapsedMs: Date.now() - startedAt } as const;
}
