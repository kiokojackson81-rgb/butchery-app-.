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

  // Idempotent create: skip duplicate expense entries
  const existing = await (prisma as any).attendantExpense.findFirst({ where: { date, outletName, name: clean, amount: amt } });
  if (existing) return NextResponse.json({ ok: true, row: { name: existing.name, amount: existing.amount, duplicate: true } });
  const row = await (prisma as any).attendantExpense.create({ data: { date, outletName, name: clean, amount: amt } });
    try {
      // Notify supervisors/admins (best-effort)
      const [sup, adm] = await Promise.all([
        (prisma as any).phoneMapping.findMany({ where: { role: "supervisor", phoneE164: { not: "" } }, select: { phoneE164: true } }),
        (prisma as any).phoneMapping.findMany({ where: { role: "admin", phoneE164: { not: "" } }, select: { phoneE164: true } }),
      ]);
      const list = [...(sup || []), ...(adm || [])].map((r: any) => r.phoneE164).filter(Boolean) as string[];
      if (list.length) {
        await Promise.allSettled(list.map((to: string) => (globalThis as any).sendText?.(to, `Expense recorded at ${outletName} (${date}): ${clean} KSh ${amt}`, "AI_DISPATCH_TEXT") ));
      }
    } catch {}
  return NextResponse.json({ ok: true, row: { name: row.name, amount: row.amount } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
