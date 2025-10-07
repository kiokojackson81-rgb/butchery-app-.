import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const since6h = new Date(Date.now() - 6 * 60 * 60_000);
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);

    const [inbound6h, loginPrompts6h, dedup24h, oocInfo24h, outbounds24h] = await Promise.all([
      (prisma as any).waMessageLog.count({ where: { direction: "in", createdAt: { gt: since6h } } }),
      (prisma as any).waMessageLog.count({ where: { status: "LOGIN_PROMPT", createdAt: { gt: since6h } } }),
      (prisma as any).waMessageLog.count({ where: { status: "INBOUND_DEDUP", createdAt: { gt: since24h } } }),
      (prisma as any).waMessageLog.findMany({ where: { type: "OOC_INFO", createdAt: { gt: since24h } }, select: { payload: true } }),
      (prisma as any).waMessageLog.findMany({ where: { direction: "out", createdAt: { gt: since24h } }, select: { status: true, payload: true } }),
    ]);

    const unauthenticatedRate = inbound6h ? loginPrompts6h / inbound6h : 0;

    // Race recoveries: count sessions where lastFinalizeAt within 20s and we logged an inbound.info shortly after
    // Approximation via OOC info presence plus recent finalize markers could be added; keep basic counters for now.

    // Interactive vs numeric: infer by inbound payload types (approximate by presence of interactive.button_reply vs numeric.route)
    const interactiveVsNumeric = { interactive: 0, numeric: 0 } as any;
    try {
      const recentInbound = await (prisma as any).waMessageLog.findMany({ where: { direction: "in", createdAt: { gt: since24h } }, select: { status: true, payload: true } });
      for (const r of recentInbound) {
        const ev = (r as any)?.payload?.event || (r as any)?.status;
        if (ev === "numeric.route") interactiveVsNumeric.numeric++;
        if ((r as any)?.payload?.interactive?.button_reply) interactiveVsNumeric.interactive++;
      }
    } catch {}

    // Duplicate outbound skips
    let duplicateOutboundSkips = 0;
    for (const o of outbounds24h) {
      if (String((o as any)?.status || "") === "NOOP") duplicateOutboundSkips++;
    }

    const meta = { sampleOOC: (oocInfo24h?.[0] as any)?.payload?.meta?.ooc ?? null };

    return NextResponse.json({ ok: true, unauthenticatedRate, inbound_dedup_hits: dedup24h, interactive_vs_numeric: interactiveVsNumeric, duplicate_outbounds_skipped: duplicateOutboundSkips, meta });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
