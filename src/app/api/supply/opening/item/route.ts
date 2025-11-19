import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { notifySupplyItem } from "@/server/supply_notify_item";

// === Simple in-memory rate limiter (per process) ===
// Keyed by (date|outlet) to avoid abusive burst submissions that could spam
// review & notification flows. This is a pragmatic guard; for multi-instance
// deployments consider a shared store (Redis) if stricter guarantees needed.
// Config:
//   SUPPLY_ITEM_RATE_LIMIT        max submissions per window (default 60)
//   SUPPLY_ITEM_RATE_WINDOW_SEC   sliding window seconds (default 60)
//   SUPPLY_ITEM_RATE_BURST        optional hard cap allowing brief bursts (default = limit)
//   SUPPLY_ITEM_RATE_DISABLE=1    disables limiter
type WindowRecord = { ts: number };
const RL_BUCKET: Record<string, WindowRecord[]> = Object.create(null);

function rateLimitCheck(key: string) {
  if (process.env.SUPPLY_ITEM_RATE_DISABLE === '1') return { allowed: true } as const;
  const limit = Math.max(1, Number(process.env.SUPPLY_ITEM_RATE_LIMIT || 60) || 60);
  const windowSec = Math.max(1, Number(process.env.SUPPLY_ITEM_RATE_WINDOW_SEC || 60) || 60);
  const burst = Math.max(limit, Number(process.env.SUPPLY_ITEM_RATE_BURST || limit) || limit);
  const now = Date.now();
  const winMs = windowSec * 1000;
  const arr = (RL_BUCKET[key] = (RL_BUCKET[key] || []).filter(r => now - r.ts <= winMs));
  if (arr.length >= burst) {
    return { allowed: false, retryAfterSec: Math.ceil((winMs - (now - arr[0].ts)) / 1000), reason: 'BURST' } as const;
  }
  if (arr.length >= limit) {
    return { allowed: false, retryAfterSec: Math.ceil((winMs - (now - arr[0].ts)) / 1000), reason: 'RATE_LIMIT' } as const;
  }
  arr.push({ ts: now });
  return { allowed: true } as const;
}

// POST /api/supply/opening/item
// Body: { date, outlet, itemKey, qty, buyPrice?, unit?, mode?: "add"|"replace" }
// - If mode=="add" (default), qty is added to any existing row for the date/outlet/item.
// - If mode=="replace", qty overwrites the existing value.
// Returns: { ok, existedQty, totalQty, row }
// Shared legacy detection (non-exported) to avoid referencing missing columns on older DB.
let SUPPLY_ITEM_LOCK_COLS: boolean | null = null;
async function detectLockCols() {
  if (SUPPLY_ITEM_LOCK_COLS != null) return SUPPLY_ITEM_LOCK_COLS;
  try {
    await (prisma as any).supplyOpeningRow.findMany({ select: { id: true, lockedAt: true }, take: 1 });
    SUPPLY_ITEM_LOCK_COLS = true;
  } catch (e: any) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('lockedat') && msg.includes('does not exist')) SUPPLY_ITEM_LOCK_COLS = false; else SUPPLY_ITEM_LOCK_COLS = true;
  }
  return SUPPLY_ITEM_LOCK_COLS;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null as any);
    const date = String(body?.date || "").slice(0, 10);
    const outlet = String(body?.outlet || "").trim();
    const itemKey = String(body?.itemKey || "").trim();
    const unit = body?.unit === "pcs" ? "pcs" : "kg";
    const mode = body?.mode === "replace" ? "replace" : "add";
    const qtyNum = Number(body?.qty || 0);
    const buyPriceNum = Number(body?.buyPrice || 0);

    if (!date || !outlet || !itemKey || !(qtyNum > 0)) {
      return NextResponse.json({ ok: false, error: "missing/invalid fields" }, { status: 400 });
    }

    // Rate limit guard (before expensive DB lookups)
    try {
      const rlKey = `${date}|${outlet}`;
      const rl = rateLimitCheck(rlKey);
      if (!rl.allowed) {
        return NextResponse.json(
          { ok: false, error: "RATE_LIMIT", message: `Too many submissions. Retry in ${rl.retryAfterSec}s`, retryAfterSec: rl.retryAfterSec },
          { status: 429 },
        );
      }
    } catch {}

    const hasLockCols = await detectLockCols();

    // Idempotency guard (30s) by signature; prevents rapid duplicates (double taps/retries)
    try {
      const sig = `${date}|${outlet}|${itemKey}|${qtyNum}|${buyPriceNum}|${unit}`;
      const key = `api:supply_idem:${sig}`;
      const existingIdem = await (prisma as any).setting.findUnique({ where: { key } }).catch(() => null);
      if (existingIdem) {
        const updatedAt = new Date(existingIdem.updatedAt).getTime();
        if (Date.now() - updatedAt < 30_000) {
          const current = await (prisma as any).supplyOpeningRow.findUnique({ where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } } }).catch(()=>null);
          const existedQtyNow = Number(current?.qty || 0);
          // If the current row is locked, prefer lock semantics and return a conflict
          if (hasLockCols && current?.lockedAt) {
            return NextResponse.json(
              { ok: false, error: "locked", message: "Supply already submitted and locked for this product." },
              { status: 409 },
            );
          }
          return NextResponse.json({ ok: true, existedQty: existedQtyNow, totalQty: existedQtyNow, row: current }, { status: 200 });
        } else {
          await (prisma as any).setting.update({ where: { key }, data: { value: { sig, at: new Date().toISOString() } } }).catch(()=>{});
        }
      } else {
        await (prisma as any).setting.create({ data: { key, value: { sig, at: new Date().toISOString(), by: String(body?.supplierCode || body?.supplierName || 'supplier_portal') } } }).catch(()=>{});
      }
    } catch {}
    let existing: any = null;
    try {
      existing = await (prisma as any).supplyOpeningRow.findUnique({
        where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } },
      });
    } catch (e: any) {
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('lockedat') && msg.includes('does not exist')) {
        SUPPLY_ITEM_LOCK_COLS = false;
        // Fallback raw select without lock columns
        existing = await (prisma as any).supplyOpeningRow.findUnique({
          where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } },
        });
      } else throw e;
    }
    const existedQty = Number(existing?.qty || 0);
    if (hasLockCols && existing?.lockedAt) {
      return NextResponse.json(
        { ok: false, error: "locked", message: "Supply already submitted and locked for this product." },
        { status: 409 },
      );
    }
    const totalQty = mode === "add" ? existedQty + qtyNum : qtyNum;
    const lockedBy = String(body?.supplierCode || body?.supplierName || "supplier_portal").trim() || "supplier_portal";
    const lockTimestamp = new Date();
    let row: any = null;
    try {
      if (hasLockCols) {
        row = await (prisma as any).supplyOpeningRow.upsert({
          where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } },
          update: {
            qty: totalQty,
            buyPrice: buyPriceNum || Number(existing?.buyPrice || 0),
            unit: unit || (existing?.unit || "kg"),
            lockedAt: existing?.lockedAt ?? lockTimestamp,
            lockedBy: existing?.lockedBy ?? lockedBy,
          },
          create: {
            date,
            outletName: outlet,
            itemKey,
            qty: totalQty,
            buyPrice: buyPriceNum,
            unit,
            lockedAt: lockTimestamp,
            lockedBy,
          },
        });
      } else {
        // Legacy: perform upsert without lock columns.
        if (existing) {
          row = await (prisma as any).supplyOpeningRow.update({
            where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } },
            data: {
              qty: totalQty,
              buyPrice: buyPriceNum || Number(existing?.buyPrice || 0),
              unit: unit || (existing?.unit || "kg"),
            },
          });
        } else {
          row = await (prisma as any).supplyOpeningRow.create({
            data: { date, outletName: outlet, itemKey, qty: totalQty, buyPrice: buyPriceNum, unit },
          });
        }
      }
    } catch (e: any) {
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('lockedat') && msg.includes('does not exist')) {
        SUPPLY_ITEM_LOCK_COLS = false; // retry without lock cols if first attempt included them
        if (existing) {
          row = await (prisma as any).supplyOpeningRow.update({
            where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } },
            data: { qty: totalQty, buyPrice: buyPriceNum || Number(existing?.buyPrice || 0), unit: unit || (existing?.unit || 'kg') },
          });
        } else {
          row = await (prisma as any).supplyOpeningRow.create({
            data: { date, outletName: outlet, itemKey, qty: totalQty, buyPrice: buyPriceNum, unit },
          });
        }
      } else throw e;
    }
    // Immediate notify for attendant visibility (allowed to fail silently)
    try { await notifySupplyItem({ outlet, date, itemKey, supplierCode: body?.supplierCode || null, supplierName: body?.supplierName || null }); } catch {}
    return NextResponse.json({ ok: true, existedQty, totalQty, row, legacyNoLock: SUPPLY_ITEM_LOCK_COLS === false });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
