import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

// GET /api/admin/day/opening?date=YYYY-MM-DD&outlet=Outlet%20Name
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const date = String(url.searchParams.get("date") || "").trim();
    const outlet = String(url.searchParams.get("outlet") || "").trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "missing date or outlet" }, { status: 400 });

    const openings = await (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet } });
    return NextResponse.json({ ok: true, date, outlet, openings });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
