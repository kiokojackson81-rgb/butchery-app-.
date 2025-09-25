import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const { outlet, date, closingMap, wasteMap } = (await req.json()) as {
    outlet: string;
    date?: string;
    closingMap: Record<string, number>;
    wasteMap: Record<string, number>;
  };
  if (!outlet) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

  const day = date || new Date().toISOString().slice(0, 10);
  const keys = Array.from(new Set([...(Object.keys(closingMap || {})), ...(Object.keys(wasteMap || {}))]));

  await prisma.$transaction(async (tx) => {
    for (const itemKey of keys) {
      const closingQty = Number(closingMap?.[itemKey] || 0);
      const wasteQty = Number(wasteMap?.[itemKey] || 0);
      await tx.attendantClosing.upsert({
        where: { date_outletName_itemKey: { date: day, outletName: outlet, itemKey } },
        create: { date: day, outletName: outlet, itemKey, closingQty, wasteQty },
        update: { closingQty, wasteQty },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
