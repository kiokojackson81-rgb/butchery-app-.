import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

type SupplyRow = {
  date: string;
  outletName: string;
  itemKey: string;
  qty?: number;
  buyPrice?: number;
  unit?: string;
};

/**
 * Admin endpoint to create/update supply opening rows.
 * Body shape: { rows: SupplyRow[] }
 * This mirrors the writes performed by supplier WA flows and is intended
 * for admin/manual corrections and automation.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body?.rows) ? body.rows as SupplyRow[] : [];
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "No supply rows provided" }, { status: 400 });
    }

    // Basic validation
    for (const r of rows) {
      if (!r || !r.date || !r.outletName || !r.itemKey) {
        return NextResponse.json({ ok: false, error: "Invalid row: require date, outletName and itemKey" }, { status: 400 });
      }
    }

    // Server-side safety: reject writes when an opening lock exists for any row
    try {
      for (const r of rows) {
        const key = `opening_lock:${r.date}:${r.outletName}`;
        const lockRow = await (prisma as any).setting.findUnique({ where: { key } }).catch(() => null);
        if (lockRow) {
          return NextResponse.json({ ok: false, error: 'Opening locked', locked: true }, { status: 423 });
        }
      }
    } catch (e) {
      // non-fatal: continue to normal flow if check fails to avoid blocking admin when DB oddities occur
    }

    const result = await (prisma as any).$transaction(async (tx: any) => {
      let processed = 0;
      for (const r of rows) {
        const where = { date_outletName_itemKey: { date: r.date, outletName: r.outletName, itemKey: r.itemKey } };
        const existing = await tx.supplyOpeningRow.findUnique({ where }).catch(() => null);
        if (existing) {
          await tx.supplyOpeningRow.update({ where: { id: existing.id }, data: { qty: typeof r.qty === 'number' ? r.qty : existing.qty, buyPrice: typeof r.buyPrice === 'number' ? r.buyPrice : existing.buyPrice, unit: r.unit ?? existing.unit } });
        } else {
          await tx.supplyOpeningRow.create({ data: { date: r.date, outletName: r.outletName, itemKey: r.itemKey, qty: typeof r.qty === 'number' ? r.qty : 0, buyPrice: typeof r.buyPrice === 'number' ? r.buyPrice : 0, unit: r.unit ?? 'kg' } });
        }
        processed += 1;
      }
      return { processed };
    });

    return NextResponse.json({ ok: true, count: result.processed });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
