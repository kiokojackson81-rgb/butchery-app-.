import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

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
    const { items } = (await req.json()) as { items: Array<{ name: string; amount: number }> };
    const data = (items || [])
      .map((i) => ({
        date,
        outletName,
        name: String(i?.name || "").trim(),
        amount: Number.isFinite(Number(i?.amount)) ? Math.max(0, Number(i?.amount)) : 0,
      }))
      .filter((d) => d.name && d.amount > 0);

    await withRetry(() => prisma.$transaction(async (tx) => {
      await (tx as any).attendantExpense.deleteMany({ where: { date, outletName } });
      if (data.length) await (tx as any).attendantExpense.createMany({ data });
    }, { timeout: 15000, maxWait: 10000 }));

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
