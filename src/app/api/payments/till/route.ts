import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sess = await getSession();
    if (!sess) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    // Prefer explicit session.outletCode; fallback to attendant's outletRef.code
    const outlet = (sess as any).outletCode || (sess as any).attendant?.outletRef?.code;
    if (!outlet) return NextResponse.json({ ok: false, error: "no_outlet_bound" }, { status: 400 });

    const url = new URL(req.url);
    const take = Math.min(Number(url.searchParams.get("take") || 50), 100);

    // Fetch recent payments for this outlet
    const rows = await (prisma as any).payment.findMany({
      where: { outletCode: outlet },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        amount: true,
        outletCode: true,
        msisdn: true,
        status: true,
        mpesaReceipt: true,
        businessShortCode: true,
        accountReference: true,
        createdAt: true,
      },
    });

    // Compute total of SUCCESS amounts for this outlet (simple reflection metric)
    const agg = await (prisma as any).payment.aggregate({
      where: { outletCode: outlet, status: "SUCCESS" },
      _sum: { amount: true },
    });
    const total = Number(agg?._sum?.amount || 0);

    return NextResponse.json({ ok: true, outlet, total, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
