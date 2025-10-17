import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { APP_TZ, dateISOInTZ } from "@/server/trading_period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized", note: "Provide STATUS_PUBLIC_KEY via header x-status-key or ?key=" },
    { status: 401 }
  );
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const providedKey = req.headers.get("x-status-key") || url.searchParams.get("key") || "";
    const requiredKey = process.env.STATUS_PUBLIC_KEY || "";
    if (!requiredKey || providedKey !== requiredKey) return unauthorized();

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
