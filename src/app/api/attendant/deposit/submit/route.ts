import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { sendTextSafe } from "@/lib/wa";
import { getSession } from "@/lib/session";
import { DepositStatus } from "@prisma/client";
import { getPeriodState } from "@/server/trading_period";

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e || "");
      if (/ConnectionReset|ECONNRESET|closed by the remote host|TLS handshake|socket|timeout/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 150 + i * 200));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  try {
    const sess = await getSession();
    if (!sess) return NextResponse.json({ ok: false }, { status: 401 });
    const outletName = (sess as any).attendant?.outletRef?.name || (sess as any).outletCode || "";
    if (!outletName) return NextResponse.json({ ok: false, error: "No outlet" }, { status: 400 });

    const date = new Date().toISOString().slice(0, 10);
  const { entries } = (await req.json()) as { entries: Array<{ code?: string; amount?: number; note?: string; status?: DepositStatus }> };
    const data = (entries || [])
      .map((e) => ({
        date,
        outletName,
        code: (e.code || "").trim() || null,
        note: (e.note || null) as string | null,
        amount: Number.isFinite(Number(e.amount)) ? Math.max(0, Number(e.amount)) : 0,
        status: (e.status as DepositStatus) || "PENDING",
      }))
      .filter((d) => d.amount > 0 || !!d.code);

    // Guard: Trading period must be OPEN
    const state = await getPeriodState(outletName, date);
    if (state !== "OPEN") return NextResponse.json({ ok: false, error: `Day is locked for ${outletName} (${date}).` }, { status: 409 });

    // Perform idempotent per-entry creates: skip entries that already exist with same date/outlet/code/amount/note
    await withRetry(() => prisma.$transaction(async (tx) => {
      for (const d of data) {
        const exists = await (tx as any).attendantDeposit.findFirst({ where: { date: d.date, outletName: d.outletName, code: d.code, amount: d.amount, note: d.note } });
        if (!exists) {
          await (tx as any).attendantDeposit.create({ data: d });
        }
      }
    }, { timeout: 15000, maxWait: 10000 }));

    // Read back saved rows and totals
    const savedRows: any[] = await withRetry(() => (prisma as any).attendantDeposit.findMany({ where: { date, outletName } }));
    const total = savedRows.reduce((s, r) => s + Number(r.amount || 0), 0);

    // Try to notify the submitting attendant(s) if we can resolve their phone(s)
    try {
      const maps: Array<{ code: string; phoneE164: string | null }> = await withRetry(() => (prisma as any).phoneMapping.findMany({ where: { role: "attendant", outlet: outletName } }));
      const codes = maps.map((m) => m.code).filter(Boolean) as string[];
      const attendants: Array<{ loginCode: string | null; name: string | null }> = codes.length
        ? await withRetry(() => (prisma as any).attendant.findMany({ where: { loginCode: { in: codes } } }))
        : [];
      const nameByCode = new Map<string, string>();
      for (const a of attendants) {
        if (a?.loginCode) nameByCode.set(a.loginCode, a.name || a.loginCode);
      }
      await Promise.allSettled(
        maps.map((m) => sendTextSafe(m.phoneE164 || "", `Deposits submitted for ${outletName}. Total: Ksh ${total}.`, "AI_DISPATCH_TEXT"))
      );
    } catch {}

  return NextResponse.json({ ok: true, total });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
