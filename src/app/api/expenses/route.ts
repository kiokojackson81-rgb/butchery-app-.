import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
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
    const { outlet, items } = (await req.json()) as {
      outlet: string;
      items: Array<{ name: string; amount: number }>;
    };
    const outletName = (outlet || "").trim();
    if (!outletName) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

    const date = new Date().toISOString().slice(0, 10);
    // Guard: Trading period must be OPEN
    const state = await getPeriodState(outletName, date);
    if (state !== "OPEN") return NextResponse.json({ ok: false, error: `Day is locked for ${outletName} (${date}).` }, { status: 409 });

    await withRetry(() => prisma.$transaction(async (tx) => {
      const data = (items || [])
        .map((i) => {
          const name = (i?.name ?? "").trim();
          const rawAmount = Number(i?.amount ?? 0);
          const amount = Number.isFinite(rawAmount) ? Math.max(0, rawAmount) : 0;
          return { date, outletName, name, amount };
        })
        .filter((d) => d.name && d.amount > 0);
      for (const d of data) {
        const exists = await tx.attendantExpense.findFirst({ where: { date: d.date, outletName: d.outletName, name: d.name, amount: d.amount } });
        if (!exists) {
          await tx.attendantExpense.create({ data: d });
        }
      }
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

    const rows = await (prisma as any).attendantExpense.findMany({
      where: { date, outletName: outlet },
      select: { name: true, amount: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
