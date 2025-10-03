import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const sess = await getSession();
    if (!sess) return NextResponse.json({ ok: false }, { status: 401 });
    const outletName = (sess as any).attendant?.outletRef?.name || (sess as any).outletCode || "";
    if (!outletName) return NextResponse.json({ ok: false, error: "No outlet" }, { status: 400 });
    const date = new Date().toISOString().slice(0, 10);

    const { name, amount } = (await req.json()) as { name?: string; amount?: number };
    const clean = (name || "").trim();
    const amt = Number.isFinite(Number(amount)) ? Math.max(0, Number(amount)) : 0;
    if (!clean || amt <= 0) return NextResponse.json({ ok: false, error: "name/amount required" }, { status: 400 });

    const row = await (prisma as any).attendantExpense.create({ data: { date, outletName, name: clean, amount: amt } });
    return NextResponse.json({ ok: true, row: { name: row.name, amount: row.amount } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
