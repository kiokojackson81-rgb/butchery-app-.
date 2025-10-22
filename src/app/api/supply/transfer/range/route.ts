import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET(req: Request) {
  try {
    const sess = await getSession().catch(() => null);
    if (!sess) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const from = String((searchParams.get("from") || "")).slice(0, 10);
    const to = String((searchParams.get("to") || "")).slice(0, 10);
  let outlet = String((searchParams.get("outlet") || "")).trim();
    const limit = Math.max(1, Math.min(2000, Number(searchParams.get("limit") || 1000)));

    if (!from || !to) return NextResponse.json({ ok: false, error: "from/to required" }, { status: 400 });
    const f = new Date(from);
    const t = new Date(to);
    if (!(f <= t)) return NextResponse.json({ ok: false, error: "invalid range" }, { status: 400 });
    // Enforce max range of 31 days
    const days = Math.ceil((t.getTime() - f.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (days > 31) return NextResponse.json({ ok: false, error: "range too large (max 31 days)" }, { status: 400 });

    // If the session is scoped to an outlet (typical for attendants/suppliers),
    // enforce that scope: if the caller provided a different outlet param, deny.
    const sessionOutletCode = (sess as any)?.outletCode || (sess as any)?.attendant?.outletRef?.code || undefined;
    if (sessionOutletCode) {
      // If outlet query is provided and doesn't match the session's outlet, forbid.
      if (outlet && outlet !== sessionOutletCode) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
      }
      outlet = sessionOutletCode;
    }

    const where: any = { date: { gte: from, lte: to } };
    if (outlet) where.OR = [{ fromOutletName: outlet }, { toOutletName: outlet }];

    const rows = await (prisma as any).supplyTransfer.findMany({ where, orderBy: [{ date: 'desc' }], take: limit });
    return NextResponse.json({ ok: true, rows, count: Array.isArray(rows) ? rows.length : 0, range: { from, to } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
