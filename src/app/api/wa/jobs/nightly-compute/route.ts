import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { isAuthorizedByKey } from "@/lib/apiGuard";
import { computeAllOutletsPerformance } from "@/lib/analytics/performance.service";
import { computeAllAttendantKPIs } from "@/lib/analytics/attendant-kpi.service";
import { buildDailyProductSupplyStats, computeSupplyRecommendations } from "@/lib/analytics/supply-insights.service";
import { nightlyRecalcOpenIntervals, closeOpenSupplyIntervalsIfNeeded } from "@/lib/analytics/intervals.service";

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

async function runNightly(date: string, outlet?: string) {
  if (outlet) {
    await computeAllOutletsPerformance(date);
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
}

export async function GET(req: Request) {
  const started = Date.now();
  try {
    const url = new URL(req.url);
    const date = (url.searchParams.get("date") || todayISO()).slice(0, 10);
    const outlet = (url.searchParams.get("outlet") || "").trim() || undefined;

    // Optional lightweight protection: require header/qs when CRON_SECRET is set
    if (!isAuthorizedByKey(req, "CRON_SECRET", "x-cron-key", "key")) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    await runNightly(date, outlet);
    const ms = Date.now() - started;
    return NextResponse.json({ ok: true, date, outlet: outlet || null, ms });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
