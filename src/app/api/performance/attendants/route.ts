// src/app/api/performance/attendants/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from = String(searchParams.get("from") || "").slice(0, 10);
    const to = String(searchParams.get("to") || "").slice(0, 10);
    const outletName = String(searchParams.get("outlet") || "").trim();
    const attendantId = String(searchParams.get("attendantId") || "").trim();
    const where: any = {};
    if (from || to) where.date = { gte: from || undefined, lte: to || undefined };
    if (outletName) where.outletName = outletName;
    if (attendantId) where.attendantId = attendantId;
    const rows = await (prisma as any).attendantKPI.findMany({ where, orderBy: [{ date: "asc" }, { outletName: "asc" }] });
    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
