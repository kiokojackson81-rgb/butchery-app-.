// src/app/api/day/submit/route.ts
import { NextResponse } from "next/server";
import { submitDay } from "@/lib/analytics/day-close.service";
import { isAuthorizedByKey } from "@/lib/apiGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    if (!isAuthorizedByKey(req, "ADMIN_API_KEY")) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const j = await req.json().catch(() => ({}));
    const outlet = String(j?.outlet || j?.outletName || "").trim();
    const businessDate = String(j?.businessDate || j?.date || "").slice(0, 10);
    if (!outlet || !businessDate) return NextResponse.json({ ok: false, error: "Missing outlet or businessDate" }, { status: 400 });
    await submitDay(outlet, new Date(businessDate + "T00:00:00.000Z"));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
