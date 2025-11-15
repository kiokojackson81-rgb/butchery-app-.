import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

// Runtime flag to detect legacy DB missing lockedAt/lockedBy columns.
// We attempt a lightweight query selecting lockedAt once; if it fails with a 'does not exist' error
// we fall back to legacy mode (no lock metadata persisted / returned).
let SUPPLY_LOCK_COLS_AVAILABLE: boolean | null = null;
async function ensureSupplyLockCols() {
  if (SUPPLY_LOCK_COLS_AVAILABLE != null) return SUPPLY_LOCK_COLS_AVAILABLE;
  try {
    // Attempt a trivial select with limit 1 including lockedAt
    await (prisma as any).supplyOpeningRow.findMany({ select: { id: true, lockedAt: true }, take: 1 });
    SUPPLY_LOCK_COLS_AVAILABLE = true;
  } catch (e: any) {
    const msg = String(e?.message || "").toLowerCase();
    if (msg.includes("lockedat") && msg.includes("does not exist")) SUPPLY_LOCK_COLS_AVAILABLE = false;
    else SUPPLY_LOCK_COLS_AVAILABLE = true; // treat other errors as transient
  }
  return SUPPLY_LOCK_COLS_AVAILABLE;
}

export async function POST(req: Request) {
  const { date, outlet, rows } = (await req.json()) as {
    date: string;
    outlet: string;
    rows: Array<{ itemKey: string; qty: number; buyPrice?: number; unit?: "kg" | "pcs" }>;
  };

  if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });

  const hasLockCols = await ensureSupplyLockCols();
  await prisma.$transaction(async (tx) => {
    const payload = Array.isArray(rows) ? rows : [];
    if (!payload.length) return;

    const [products, existingRows] = await Promise.all([
      tx.product.findMany({ select: { key: true, unit: true } }),
      // Legacy DB may not have lockedAt/lockedBy yet; select minimal columns.
      (tx as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet }, select: hasLockCols ? { id: true, itemKey: true, qty: true, buyPrice: true, unit: true, lockedAt: true, lockedBy: true } : { id: true, itemKey: true, qty: true, buyPrice: true, unit: true } }),
    ]);

  const unitByKey = new Map<string, string>(products.map((p: any) => [p.key, p.unit || "kg"]));
  const existingByKey = new Map<string, any>((existingRows as any[]).map((r: any) => [r.itemKey, r]));
    const deletableIds: string[] = [];

    // Mark existing unlocked rows for deletion if they are absent from the payload.
    for (const existing of existingRows) {
      if (existing.lockedAt) continue;
      const key = existing.itemKey;
      if (!payload.some((r) => String(r?.itemKey || "").trim() === key)) {
        deletableIds.push(existing.id);
      }
    }

    for (const row of payload) {
      const itemKey = String(row?.itemKey || "").trim();
      if (!itemKey) continue;

      const qtyNum = Number(row?.qty ?? 0);
      const buyPriceNum = Number(row?.buyPrice ?? 0);
      const unit =
        row?.unit === "pcs"
          ? "pcs"
          : row?.unit === "kg"
            ? "kg"
            : (unitByKey.get(itemKey) as "kg" | "pcs") || "kg";

      const existing = existingByKey.get(itemKey);
      if (hasLockCols && existing && (existing as any).lockedAt) {
        // Skip unlocked draft writes for locked rows; they stay intact.
        continue;
      }

      if (existing) {
        await tx.supplyOpeningRow.update({
          where: { id: existing.id },
          data: {
            qty: qtyNum,
            buyPrice: Number.isFinite(buyPriceNum) ? buyPriceNum : (existing as any).buyPrice,
            unit,
          },
        });
      } else {
        await tx.supplyOpeningRow.create({
          data: {
            date,
            outletName: outlet,
            itemKey,
            qty: qtyNum,
            buyPrice: Number.isFinite(buyPriceNum) ? buyPriceNum : 0,
            unit,
          },
        });
      }
    }

    if (deletableIds.length) {
      await tx.supplyOpeningRow.deleteMany({ where: { id: { in: deletableIds } } });
    }
  });

  // Do not send full summary on bulk opening post; summary is sent on lock only.

  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").slice(0, 10);
    const outlet = (searchParams.get("outlet") || "").trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });
    const hasLockCols = await ensureSupplyLockCols();
    let rows: any[] = [];
    try {
      rows = await (prisma as any).supplyOpeningRow.findMany({
        where: { date, outletName: outlet },
        select: hasLockCols ? { itemKey: true, qty: true, unit: true, buyPrice: true, lockedAt: true, lockedBy: true } : { itemKey: true, qty: true, unit: true, buyPrice: true },
        orderBy: { itemKey: "asc" },
      });
    } catch (e: any) {
      // Legacy fallback if migration missing
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('lockedat') && msg.includes('does not exist')) {
        SUPPLY_LOCK_COLS_AVAILABLE = false;
        rows = await (prisma as any).supplyOpeningRow.findMany({
          where: { date, outletName: outlet },
          select: { itemKey: true, qty: true, unit: true, buyPrice: true },
          orderBy: { itemKey: 'asc' },
        });
      } else throw e;
    }
    const opening = (rows || []).map((r: any) => ({
      itemKey: r.itemKey,
      qty: Number(r.qty || 0),
      unit: (r.unit === 'pcs' ? 'pcs' : 'kg') as 'kg' | 'pcs',
      buyPrice: Number(r.buyPrice || 0),
      locked: SUPPLY_LOCK_COLS_AVAILABLE ? Boolean(r.lockedAt) : Boolean(false),
      lockedAt: SUPPLY_LOCK_COLS_AVAILABLE && r.lockedAt ? new Date(r.lockedAt).toISOString() : null,
      lockedBy: SUPPLY_LOCK_COLS_AVAILABLE ? (r.lockedBy || null) : null,
    }));
    return NextResponse.json({ ok: true, rows: opening, legacyNoLock: SUPPLY_LOCK_COLS_AVAILABLE === false });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 });
  }
}
