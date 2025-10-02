import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { notifySupplyPosted } from "@/server/supply_notify";

export async function POST(req: Request) {
  const { date, outlet, rows } = (await req.json()) as {
    date: string;
    outlet: string;
    rows: Array<{ itemKey: string; qty: number; buyPrice?: number; unit?: "kg" | "pcs" }>;
  };

  if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.supplyOpeningRow.deleteMany({ where: { date, outletName: outlet } });

    // try to resolve unit from Product if not specified
    const products = await tx.product.findMany();
    const unitByKey = Object.fromEntries(products.map((p) => [p.key, p.unit]));

    if (Array.isArray(rows) && rows.length) {
      await tx.supplyOpeningRow.createMany({
        data: rows.map((r) => ({
          date,
          outletName: outlet,
          itemKey: r.itemKey,
          qty: Number(r.qty || 0),
          buyPrice: Number(r.buyPrice || 0),
          unit: r.unit || (unitByKey[r.itemKey] || "kg"),
        })),
      });
    }
  });

  // Optional: auto-notify via WhatsApp after supply is posted
  try {
    // DB setting overrides env; fall back to env if no setting exists
    const setting = await (prisma as any).setting.findUnique({ where: { key: "auto_notify_supply" } });
    const dbEnabled = setting?.value === true || String(setting?.value).toLowerCase() === "true";
    const envEnabled = String(process.env.WA_NOTIFY_ON_SUPPLY || "").toLowerCase() === "true";
    if (dbEnabled || envEnabled) await notifySupplyPosted({ outletName: outlet, date });
  } catch {}

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
      select: { itemKey: true, qty: true },
      orderBy: { itemKey: "asc" },
    });
    const opening = (rows || []).map((r: any) => ({ itemKey: r.itemKey, qty: Number(r.qty || 0) }));
    return NextResponse.json({ ok: true, rows: opening });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
