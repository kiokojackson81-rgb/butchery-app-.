import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { parseMpesaText, addDeposit } from "@/server/deposits";
import { listDryDeposits } from "@/lib/dev_dry";
import { getPeriodState } from "@/server/trading_period";

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e || "");
      // Retry on common transient errors
      if (/ConnectionReset|ECONNRESET|closed by the remote host|TLS handshake|socket|timeout/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 150 + i * 200));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}
import { DepositStatus } from "@prisma/client";

export async function POST(req: Request) {
  try {
    const { outlet, entries } = (await req.json()) as {
      outlet: string;
      entries: Array<{ code?: string; amount?: number; note?: string; rawMessage?: string; status?: "VALID" | "PENDING" | "INVALID" }>;
    };
    const outletName = (outlet || "").trim();
    if (!outletName) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

    const date = new Date().toISOString().slice(0, 10);
    // Guard: Trading period must be OPEN
    const state = await getPeriodState(outletName, date);
    if (state !== "OPEN") return NextResponse.json({ ok: false, error: `Day is locked for ${outletName} (${date}).` }, { status: 409 });

    let savedCount = 0;
    // Use addDeposit helper for each entry so DRY/dev fallback works when DB is not available
    const processed: Array<any> = [];
    for (const e of (entries || [])) {
      try {
        let code = (e.code ?? "").trim();
        let amountRaw = Number(e.amount ?? NaN);
        if ((!code || !Number.isFinite(amountRaw)) && (e.rawMessage || e.note)) {
          const parsed = parseMpesaText(String(e.rawMessage || e.note || ""));
          if (parsed) {
            if (!code) code = parsed.ref;
            if (!Number.isFinite(amountRaw)) amountRaw = parsed.amount;
          }
        }
        const amount = Number.isFinite(amountRaw) ? Math.max(0, amountRaw) : 0;
        const note = (e.note ?? null) as string | null;
        // Only attempt to create meaningful deposits
        if (amount > 0 || (code && code !== "")) {
          const res = await addDeposit({ date, outletName, amount, note: note || undefined, code: code || undefined });
          processed.push(res);
          savedCount += 1;
        }
      } catch (err) {
        // best-effort: continue processing other entries
      }
    }

    // Best-effort verification stub: mark as VALID if env flag is set
    try {
      if (String(process.env.DARAJA_VERIFY_STUB || "").toLowerCase() === "true") {
        await (prisma as any).attendantDeposit.updateMany({
          where: { date, outletName, status: "PENDING", amount: { gt: 0 }, code: { not: null } },
          data: { status: "VALID" },
        });
      }
    } catch {}

  return NextResponse.json({ ok: true, savedCount, processed });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").slice(0, 10);
    const outlet = (searchParams.get("outlet") || "").trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });
    try {
      const rows = await (prisma as any).attendantDeposit.findMany({
        where: { date, outletName: outlet },
        select: { code: true, amount: true, note: true, status: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      return NextResponse.json({ ok: true, rows });
    } catch (e) {
      // Fallback to in-memory DRY store when DB unavailable (dev mode)
      try {
  const rows = listDryDeposits(outlet, date, 50).map((r: any) => ({ id: r.id, code: null, amount: r.amount, note: r.note, status: r.status, createdAt: r.createdAt }));
        return NextResponse.json({ ok: true, rows });
      } catch {
        return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
      }
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
