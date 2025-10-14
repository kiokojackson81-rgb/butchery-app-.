import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { notifySupplyPosted } from "@/server/supply_notify";

// POST /api/supply/opening/item
// Body: { date, outlet, itemKey, qty, buyPrice?, unit?, mode?: "add"|"replace" }
// - If mode=="add" (default), qty is added to any existing row for the date/outlet/item.
// - If mode=="replace", qty overwrites the existing value.
// Returns: { ok, existedQty, totalQty, row }
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

    const existing = await (prisma as any).supplyOpeningRow.findUnique({
      where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } },
    });
    const existedQty = Number(existing?.qty || 0);

    const totalQty = mode === "add" ? existedQty + qtyNum : qtyNum;

    const row = await (prisma as any).supplyOpeningRow.upsert({
      where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } },
      update: { qty: totalQty, buyPrice: buyPriceNum || Number(existing?.buyPrice || 0), unit: unit || (existing?.unit || "kg") },
      create: { date, outletName: outlet, itemKey, qty: totalQty, buyPrice: buyPriceNum, unit },
    });
    // Fire auto-notify (multi-role) with lightweight dedupe: skip if a notify happened in last 30s for outlet+date
    try {
      const dedupeKey = `supply_notify_last:${date}:${outlet}`;
      const setting = await (prisma as any).setting.findUnique({ where: { key: dedupeKey } }).catch(() => null);
      const now = Date.now();
      const last = Number((setting?.value as any)?.ts || 0);
      if (!last || now - last > 30_000) {
        await notifySupplyPosted({ outletName: outlet, date });
        await (prisma as any).setting.upsert({
          where: { key: dedupeKey },
          update: { value: { ts: now } },
          create: { key: dedupeKey, value: { ts: now } },
        });
      }
    } catch {}

    return NextResponse.json({ ok: true, existedQty, totalQty, row });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
