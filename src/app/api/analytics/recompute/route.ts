import { NextResponse } from "next/server";
import { recomputeAnalytics } from "@/lib/analytics/recompute.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isDateKey(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export async function POST(req: Request) {
  try {
    const key = req.headers.get("x-internal-key");
    if (process.env.INTERNAL_API_KEY && key !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const date = String(body.date || body.businessDate || "").slice(0, 10);
    if (!isDateKey(date)) {
      return NextResponse.json({ ok: false, error: "BAD_DATE" }, { status: 400 });
    }
    const outlet = body.outlet || body.outletName || null;
    const dryRun = !!body.dryRun;
  const result = await recomputeAnalytics({ date, outlet, dryRun });
  return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
