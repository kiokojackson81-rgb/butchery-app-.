import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
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

    const { closingMap, wasteMap } = (await req.json()) as { closingMap?: Record<string, number>; wasteMap?: Record<string, number> };
    const safeClosing = (closingMap && typeof closingMap === "object") ? closingMap : {};
    const safeWaste = (wasteMap && typeof wasteMap === "object") ? wasteMap : {};
    const keys = Array.from(new Set([...(Object.keys(safeClosing)), ...(Object.keys(safeWaste))]))
      .map((k) => (k || "").trim())
      .filter(Boolean);

    // Guard: Trading period must be OPEN
    const state = await getPeriodState(outletName, date);
    if (state !== "OPEN") {
      return NextResponse.json({ ok: false, error: `Day is locked for ${outletName} (${date}).` }, { status: 409 });
    }

    await withRetry(() => prisma.$transaction(async (tx) => {
      for (const itemKey of keys) {
        const rawClosing = Number((safeClosing as any)?.[itemKey] ?? 0);
        const rawWaste = Number((safeWaste as any)?.[itemKey] ?? 0);
        const closingQty = Number.isFinite(rawClosing) ? Math.max(0, rawClosing) : 0;
        const wasteQty = Number.isFinite(rawWaste) ? Math.max(0, rawWaste) : 0;
        // Prevent duplicate overwrite if closed exists (idempotent upsert ok, but spec wants single submit per product)
        const exists = await (tx as any).attendantClosing.findUnique({ where: { date_outletName_itemKey: { date, outletName, itemKey } } });
        if (exists) continue; // ignore duplicates silently to keep idempotent
        await (tx as any).attendantClosing.upsert({
          where: { date_outletName_itemKey: { date, outletName, itemKey } },
          create: { date, outletName, itemKey, closingQty, wasteQty },
          update: { closingQty, wasteQty },
        });
      }
      // Do not delete other items; each product closes once per day
    }, { timeout: 20000, maxWait: 12000 }));

  const rows = await (prisma as any).attendantClosing.findMany({ where: { date, outletName } });
    const closingMapOut: Record<string, number> = {};
    const wasteMapOut: Record<string, number> = {};
    for (const r of rows) {
      closingMapOut[(r as any).itemKey] = Number((r as any).closingQty || 0);
      wasteMapOut[(r as any).itemKey] = Number((r as any).wasteQty || 0);
    }

    return NextResponse.json({ ok: true, date, outlet: outletName, closingMap: closingMapOut, wasteMap: wasteMapOut });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
