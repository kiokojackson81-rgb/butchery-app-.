import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { parseMpesaText } from "@/server/deposits";

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

    await withRetry(() => prisma.$transaction(async (tx) => {
      await tx.attendantDeposit.deleteMany({ where: { date, outletName } });
      const data = (entries || [])
        .map((e) => {
          // Auto-extract from pasted M-Pesa SMS if code/amount missing
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
          const status = ((e.status as DepositStatus) || "PENDING") as DepositStatus;
          const note = (e.note ?? null) as string | null;
          return {
            date,
            outletName,
            code: code || null,
            note,
            amount,
            status,
          };
        })
        .filter((d) => d.amount > 0 || (d.code && d.code !== ""));
      if (data.length) await tx.attendantDeposit.createMany({ data });
    }, { timeout: 15000, maxWait: 10000 }));

    return NextResponse.json({ ok: true });
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

    const rows = await (prisma as any).attendantDeposit.findMany({
      where: { date, outletName: outlet },
      select: { code: true, amount: true, note: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
