import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
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

    await withRetry(() => prisma.$transaction(async (tx) => {
      await (tx as any).attendantDeposit.deleteMany({ where: { date, outletName } });
      if (data.length) await (tx as any).attendantDeposit.createMany({ data });
    }, { timeout: 15000, maxWait: 10000 }));

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
