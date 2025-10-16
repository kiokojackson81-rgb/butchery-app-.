import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
// Legacy sendClosingSubmitted replaced by rich notifications
import { sendDayCloseNotifications } from "@/server/notifications/day_close";
import { upsertAndNotifySupervisorCommission } from "@/server/commission";
import { getPeriodState } from "@/server/trading_period";

type ClosingRow = { itemKey: string; closingQty: number; wasteQty: number };
type PhoneMap = { code: string; phoneE164: string | null };
type AttendantRow = { loginCode: string | null; name: string | null };

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
    const { outlet, date, closingMap, wasteMap } = (await req.json()) as {
      outlet: string;
      date?: string;
      closingMap: Record<string, number>;
      wasteMap: Record<string, number>;
    };
    const outletName = (outlet || "").trim();
    if (!outletName) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

    const day = ((date || new Date().toISOString()) + "").slice(0, 10);
    const safeClosing = (closingMap && typeof closingMap === "object") ? closingMap : {};
    const safeWaste = (wasteMap && typeof wasteMap === "object") ? wasteMap : {};
    const rawKeys = Array.from(new Set([...(Object.keys(safeClosing)), ...(Object.keys(safeWaste))]));
    const keys = rawKeys.map((k) => (k ?? "").trim()).filter((k) => k.length > 0);
    let prunedCount = 0;

    // Guard: Trading period must be OPEN
    const state = await getPeriodState(outletName, day);
    if (state !== "OPEN") {
      return NextResponse.json({ ok: false, error: `Day is locked for ${outletName} (${day}).` }, { status: 409 });
    }

    // Preload opening-effective map for validation (case-insensitive)
    const openEffMap: Map<string, number> = new Map(); // keys = itemKey.toLowerCase()
    try {
      const y = new Date((day + "T00:00:00.000Z")); y.setUTCDate(y.getUTCDate() - 1);
      const yStr = y.toISOString().slice(0,10);
      const [prevClosing, todaySupply] = await Promise.all([
        (prisma as any).attendantClosing.findMany({ where: { date: yStr, outletName: outletName } }),
        (prisma as any).supplyOpeningRow.findMany({ where: { date: day, outletName: outletName } }),
      ]);
      for (const r of prevClosing || []) {
        const k = String((r as any).itemKey || "").toLowerCase();
        const q = Number((r as any).closingQty || 0);
        if (!Number.isFinite(q)) continue; openEffMap.set(k, (openEffMap.get(k) || 0) + q);
      }
      for (const r of todaySupply || []) {
        const k = String((r as any).itemKey || "").toLowerCase();
        const q = Number((r as any).qty || 0);
        if (!Number.isFinite(q)) continue; openEffMap.set(k, (openEffMap.get(k) || 0) + q);
      }
    } catch {}

  await withRetry(() => prisma.$transaction(async (tx: any) => {
      for (const itemKey of keys) {
        const rawClosing = Number((safeClosing as any)?.[itemKey] ?? 0);
        const rawWaste = Number((safeWaste as any)?.[itemKey] ?? 0);
        const closingQty = Number.isFinite(rawClosing) ? Math.max(0, rawClosing) : 0;
        const wasteQty = Number.isFinite(rawWaste) ? Math.max(0, rawWaste) : 0;

        // Validate: closing cannot exceed opening-effective minus waste (tolerance 1e-6)
        const openEff = Number(openEffMap.get(String(itemKey).toLowerCase()) || 0);
        const maxClosing = Math.max(0, openEff - wasteQty);
        if (closingQty > maxClosing + 1e-6) {
          throw new Error(`Invalid closing for ${itemKey}: closing ${closingQty} exceeds available ${maxClosing} (OpeningEff ${openEff} - Waste ${wasteQty}).`);
        }
        await tx.attendantClosing.upsert({
          where: { date_outletName_itemKey: { date: day, outletName, itemKey } },
          create: { date: day, outletName, itemKey, closingQty, wasteQty },
          update: { closingQty, wasteQty },
        });
      }

      // Prune stale rows not present in this payload so the DB matches the submitted set
      if (keys.length > 0) {
        const res = await tx.attendantClosing.deleteMany({
          where: {
            date: day,
            outletName,
            itemKey: { notIn: keys },
          },
        });
        prunedCount = (res as any)?.count ?? 0;
      } else {
        // If nothing submitted, clear any existing rows for the day/outlet
        const res = await tx.attendantClosing.deleteMany({ where: { date: day, outletName } });
        prunedCount = (res as any)?.count ?? 0;
      }
  }, { timeout: 15000, maxWait: 10000 }));

    // Read back rows to compute actual saved maps and counts
    const rows: ClosingRow[] = await withRetry<ClosingRow[]>(
      () => (prisma as any).attendantClosing.findMany({ where: { date: day, outletName } }) as Promise<ClosingRow[]>
    );
    const closingMapOut: Record<string, number> = {};
    const wasteMapOut: Record<string, number> = {};
    for (const r of rows) {
      const k = r.itemKey;
      closingMapOut[k] = Number(r.closingQty || 0);
      wasteMapOut[k] = Number(r.wasteQty || 0);
    }
    const savedCount = rows.length;

    // Send rich day-close notifications to all parties (attendant, supervisor, admin, supplier)
    try { await sendDayCloseNotifications({ date: day, outletName, attendantCode: null }); } catch {}

    // Fire-and-forget: compute profit, upsert commission, notify supervisors
    try { await upsertAndNotifySupervisorCommission(day, outletName); } catch {}

    return NextResponse.json({ ok: true, outlet: outletName, date: day, savedCount, prunedCount, closingMap: closingMapOut, wasteMap: wasteMapOut });
  } catch (e) {
    const msg = String((e as any)?.message || "Failed");
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").slice(0, 10);
    const outlet = (searchParams.get("outlet") || "").trim();
    if (!date || !outlet) {
      return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });
    }

    const rowsArr2: any[] = await (prisma as any).attendantClosing.findMany({ where: { date, outletName: outlet } });
    const closingMap: Record<string, number> = {};
    const wasteMap: Record<string, number> = {};
    for (const r of rowsArr2) {
      const key = (r as any).itemKey;
      closingMap[key] = Number((r as any).closingQty || 0);
      wasteMap[key] = Number((r as any).wasteQty || 0);
    }
    return NextResponse.json({ ok: true, closingMap, wasteMap });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
