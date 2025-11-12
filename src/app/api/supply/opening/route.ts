import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const { date, outlet, rows } = (await req.json()) as {
    date: string;
    outlet: string;
    rows: Array<{ itemKey: string; qty: number; buyPrice?: number; unit?: "kg" | "pcs" }>;
  };

  if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    const payload = Array.isArray(rows) ? rows : [];
    if (!payload.length) return;

    const [products, existingRows] = await Promise.all([
      tx.product.findMany({ select: { key: true, unit: true } }),
      tx.supplyOpeningRow.findMany({ where: { date, outletName: outlet } }),
    ]);

    const unitByKey = new Map(products.map((p) => [p.key, p.unit || "kg"]));
    const existingByKey = new Map(existingRows.map((r) => [r.itemKey, r]));
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
      if (existing && existing.lockedAt) {
        // Skip unlocked draft writes for locked rows; they stay intact.
        continue;
      }

      if (existing) {
        await tx.supplyOpeningRow.update({
          where: { id: existing.id },
          data: {
            qty: qtyNum,
            buyPrice: Number.isFinite(buyPriceNum) ? buyPriceNum : existing.buyPrice,
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

    const rows = await (prisma as any).supplyOpeningRow.findMany({
      where: { date, outletName: outlet },
      select: { itemKey: true, qty: true, unit: true, buyPrice: true, lockedAt: true, lockedBy: true },
      orderBy: { itemKey: "asc" },
    });
    const opening = (rows || []).map((r: any) => ({
      itemKey: r.itemKey,
      qty: Number(r.qty || 0),
      unit: (r.unit === "pcs" ? "pcs" : "kg") as "kg" | "pcs",
      buyPrice: Number(r.buyPrice || 0),
      locked: Boolean(r.lockedAt),
      lockedAt: r.lockedAt ? new Date(r.lockedAt).toISOString() : null,
      lockedBy: r.lockedBy || null,
    }));
    return NextResponse.json({ ok: true, rows: opening });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
