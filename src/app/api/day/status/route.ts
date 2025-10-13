// src/app/api/day/status/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const outlet = String(searchParams.get("outlet") || searchParams.get("outletName") || "").trim();
    const date = String(searchParams.get("date") || searchParams.get("businessDate") || "").slice(0, 10);
    if (!outlet || !date) return NextResponse.json({ ok: false, error: "Missing outlet/date" }, { status: 400 });
    const row = await (prisma as any).dayClosePeriod.findUnique({ where: { outletName_businessDate: { outletName: outlet, businessDate: date } } });
    return NextResponse.json({ ok: true, row: row || null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
