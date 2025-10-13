// src/app/api/day/lock/route.ts
import { NextResponse } from "next/server";
import { lockDay } from "@/lib/analytics/day-close.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const j = await req.json().catch(() => ({}));
    const outlet = String(j?.outlet || j?.outletName || "").trim();
    const businessDate = String(j?.businessDate || j?.date || "").slice(0, 10);
    const lockedBy = String(j?.lockedBy || j?.userId || "system");
    if (!outlet || !businessDate) return NextResponse.json({ ok: false, error: "Missing outlet or businessDate" }, { status: 400 });
    await lockDay(outlet, new Date(businessDate + "T00:00:00.000Z"), lockedBy);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
