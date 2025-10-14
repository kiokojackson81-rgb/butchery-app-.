import { computeOutletPerformance, listDistinctOutlets } from "@/lib/analytics/performance.service";
import { computeAllAttendantKPIs } from "@/lib/analytics/attendant-kpi.service";
import { recomputeSupervisorCommission, SupervisorCommissionRecomputeSummary } from "@/lib/analytics/supervisor-commission.service";

export type RecomputeOptions = { date: string; outlet?: string | null; dryRun?: boolean };

export async function recomputeAnalytics(opts: RecomputeOptions) {
  const date = opts.date;
  const startedAt = Date.now();
  const touched: Array<{ outlet: string; outletPerformance: boolean; attendantKPIs: boolean }> = [];
  const supervisor: SupervisorCommissionRecomputeSummary[] = [];
  const doSupervisor = process.env.SUPERVISOR_COMMISSION_RECOMPUTE === "1";
  if (opts.outlet) {
    if (!opts.dryRun) {
      await computeOutletPerformance(date, opts.outlet);
      await computeAllAttendantKPIs(date, opts.outlet);
    }
    touched.push({ outlet: opts.outlet, outletPerformance: true, attendantKPIs: true });
    if (doSupervisor) {
      const sc = await recomputeSupervisorCommission(date, opts.outlet, { dryRun: opts.dryRun });
      supervisor.push(sc);
    }
  } else {
    const outlets = await listDistinctOutlets();
    for (const o of outlets) {
      if (!opts.dryRun) {
        await computeOutletPerformance(date, o);
        await computeAllAttendantKPIs(date, o);
      }
      touched.push({ outlet: o, outletPerformance: true, attendantKPIs: true });
      if (doSupervisor) {
        const sc = await recomputeSupervisorCommission(date, o, { dryRun: opts.dryRun });
        supervisor.push(sc);
      }
    }
  }
  const base = { ok: true, date, dryRun: !!opts.dryRun, outlets: touched, supervisor: doSupervisor ? supervisor : undefined, elapsedMs: Date.now() - startedAt } as const;
  return (opts.outlet ? { ...base, outlet: opts.outlet } : base) as typeof base & { outlet?: string };
}
