import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const mod = await import("@/lib/prisma");
    const prisma: any = (mod as any).prisma;
    if (!prisma) return NextResponse.json({ ok: false, error: "no_prisma_export" }, { status: 500 });

    // Minimal probes: counts from a few tables that should exist
    const [pricebookCount, tillCount, paymentCount] = await Promise.all([
      prisma.pricebookRow.count().catch((e: any) => ({ error: String(e?.message || e) })),
      prisma.till.count().catch((e: any) => ({ error: String(e?.message || e) })),
      prisma.payment.count().catch((e: any) => ({ error: String(e?.message || e) })),
    ]);

    return NextResponse.json({ ok: true, counts: { pricebookRow: pricebookCount, till: tillCount, payment: paymentCount } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
