import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET() {
  try {
    const sess = await getSession();
    if (!sess) return NextResponse.json({ ok: false }, { status: 401 });
    const outletName = (sess as any).attendant?.outletRef?.name || (sess as any).outletCode || "";
    if (!outletName) return NextResponse.json({ ok: false, error: "No outlet" }, { status: 400 });

    const date = new Date().toISOString().slice(0, 10);
    const [deposits, expenses] = await Promise.all([
      (prisma as any).attendantDeposit.findMany({ where: { date, outletName }, orderBy: { createdAt: "desc" }, take: 10 }),
      (prisma as any).attendantExpense.findMany({ where: { date, outletName }, orderBy: { createdAt: "desc" }, take: 10 }),
    ]);

    return NextResponse.json({ ok: true, deposits, expenses });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
