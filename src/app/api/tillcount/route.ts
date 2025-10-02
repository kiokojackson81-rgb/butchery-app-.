import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").slice(0, 10);
    const outlet = (searchParams.get("outlet") || "").trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });
    const row = await (prisma as any).attendantTillCount.findUnique({ where: { date_outletName: { date, outletName: outlet } } });
    return NextResponse.json({ ok: true, counted: Number(row?.counted || 0) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { date, outlet, counted } = await req.json();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });
    await (prisma as any).attendantTillCount.upsert({
      where: { date_outletName: { date, outletName: outlet } },
      update: { counted: Number(counted || 0) },
      create: { date, outletName: outlet, counted: Number(counted || 0) },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
