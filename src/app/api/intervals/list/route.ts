// src/app/api/intervals/list/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const outletName = String(searchParams.get("outlet") || "").trim();
    const productKey = String(searchParams.get("product") || "").trim();
    const where: any = {};
    if (outletName) where.outletName = outletName;
    if (productKey) where.productKey = productKey;
    try {
      const rows = await (prisma as any).supplyIntervalPerformance.findMany({ where, orderBy: [{ createdAt: "desc" }] });
      return NextResponse.json({ ok: true, rows });
    } catch (err: any) {
      const msg = String(err?.message || err || "");
      // If the table doesn't exist yet (migration not applied), fail open with empty rows
      if (/does not exist/i.test(msg) && /SupplyIntervalPerformance/i.test(msg)) {
        return NextResponse.json({ ok: true, rows: [], note: "intervals table missing; returning empty" });
      }
      throw err;
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
