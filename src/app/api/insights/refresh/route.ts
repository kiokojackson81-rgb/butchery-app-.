// src/app/api/insights/refresh/route.ts
import { NextResponse } from "next/server";
import { computeOutletPerformance } from "@/lib/analytics/performance.service";
import { computeAllAttendantKPIs } from "@/lib/analytics/attendant-kpi.service";
import { buildDailyProductSupplyStats, computeSupplyRecommendations } from "@/lib/analytics/supply-insights.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const j = await req.json().catch(() => ({}));
    const date = String(j?.date || j?.businessDate || "").slice(0, 10);
    const outlet = String(j?.outlet || j?.outletName || "").trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "Missing date/outlet" }, { status: 400 });
    await computeOutletPerformance(date, outlet);
    await computeAllAttendantKPIs(date, outlet);
    await buildDailyProductSupplyStats(date, outlet);
    await computeSupplyRecommendations(date, outlet);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
