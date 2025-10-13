// src/app/api/supply/stats/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = String(searchParams.get("date") || "").slice(0, 10);
    const outletName = String(searchParams.get("outlet") || "").trim();
    const where: any = {};
    if (date) where.date = date;
    if (outletName) where.outletName = outletName;
    const rows = await (prisma as any).productSupplyStat.findMany({ where, orderBy: [{ date: "asc" }, { outletName: "asc" }] });
    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
