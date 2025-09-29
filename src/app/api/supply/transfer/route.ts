import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";

function normDate(d?: string): string {
  try { const dt = d ? new Date(d) : null; if (!dt) return ""; return dt.toISOString().split("T")[0]; } catch { return ""; }
}
function trim(s?: string): string { return (s || "").trim(); }
function keyNorm(s?: string): string { return (s || "").trim().toLowerCase(); }
function toNum(n: any): number { const v = Number(n); return Number.isFinite(v) ? v : 0; }

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const date = normDate(body?.date);
    const fromOutletName = trim(body?.fromOutletName);
    const toOutletName = trim(body?.toOutletName);
    const itemKey = keyNorm(body?.itemKey);
    const qty = toNum(body?.qty);
    const unit: "kg" | "pcs" = body?.unit === "pcs" ? "pcs" : "kg";

    if (!date || !fromOutletName || !toOutletName || !itemKey) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "missing required fields" }, { status: 400 });
    }
    if (fromOutletName === toOutletName) {
      return NextResponse.json({ ok: false, code: "validation", message: "from and to must differ" }, { status: 400 });
    }
    if (qty <= 0) {
      return NextResponse.json({ ok: false, code: "validation", message: "qty must be > 0" }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      // record transfer
      await tx.supplyTransfer.create({ data: { date, fromOutletName, toOutletName, itemKey, qty, unit } });

      // adjust FROM (decrement)
      const from = await tx.supplyOpeningRow.findUnique({
        where: { date_outletName_itemKey: { date, outletName: fromOutletName, itemKey } },
      });
      const fromQty = Math.max(0, (from?.qty || 0) - qty);
      await tx.supplyOpeningRow.upsert({
        where: { date_outletName_itemKey: { date, outletName: fromOutletName, itemKey } },
        create: { date, outletName: fromOutletName, itemKey, qty: fromQty, unit, buyPrice: from?.buyPrice || 0 },
        update: { qty: fromQty },
      });

      // adjust TO (increment)
      const to = await tx.supplyOpeningRow.findUnique({
        where: { date_outletName_itemKey: { date, outletName: toOutletName, itemKey } },
      });
      const toQty = (to?.qty || 0) + qty;
      await tx.supplyOpeningRow.upsert({
        where: { date_outletName_itemKey: { date, outletName: toOutletName, itemKey } },
        create: { date, outletName: toOutletName, itemKey, qty: toQty, unit, buyPrice: to?.buyPrice || 0 },
        update: { qty: toQty },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("/api/supply/transfer POST error", err);
    return NextResponse.json({ ok: false, code: "server_error", message: err?.message || "Failed to transfer" }, { status: 500 });
  }
}
