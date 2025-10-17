import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { APP_TZ, dateISOInTZ } from "@/server/trading_period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Key check removed to allow no-key admin actions in local/internal scenarios.

export async function POST(req: Request) {
  try {
  // Previously enforced STATUS_PUBLIC_KEY via header/query. Now removed.

    const body = await req.json().catch(() => ({})) as { outlet?: string };
    const outlet = (body.outlet || "").trim();
    if (!outlet) return NextResponse.json({ ok: false, error: "missing outlet" }, { status: 400 });

    const tz = APP_TZ;
    const date = dateISOInTZ(new Date(), tz);

    // Minimal force: update ActivePeriod start to now; this is the canonical cursor we use.
    try {
      await (prisma as any).activePeriod.upsert({
        where: { outletName: outlet },
        update: { periodStartAt: new Date() },
        create: { outletName: outlet, periodStartAt: new Date() },
      });
    } catch {}

    // Also clear today's lock and allow fresh submissions.
    try { await (prisma as any).setting.deleteMany({ where: { key: { in: [`lock:attendant:${date}:${outlet}`] } } }); } catch {}

    return NextResponse.json({ ok: true, outlet, date, forced: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
