// src/server/closings.ts
import { prisma } from "@/lib/prisma";

export async function saveClosings(args: {
  date: string;
  outletName: string;
  rows: Array<{ productKey: string; closingQty: number; wasteQty: number }>;
}): Promise<void> {
  const { date, outletName, rows } = args;
  // Build opening-effective for validation: yesterday closing + today's supply
  const openEffMap: Map<string, number> = new Map();
  try {
    const dt = new Date(date + "T00:00:00.000Z"); dt.setUTCDate(dt.getUTCDate() - 1);
    const y = dt.toISOString().slice(0,10);
    const [prev, supply] = await Promise.all([
      (prisma as any).attendantClosing.findMany({ where: { date: y, outletName } }),
      (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName } }),
    ]);
    for (const r of prev || []) {
      const k = (r as any).itemKey; const q = Number((r as any).closingQty || 0);
      if (!Number.isFinite(q)) continue; openEffMap.set(k, (openEffMap.get(k) || 0) + q);
    }
    for (const r of supply || []) {
      const k = (r as any).itemKey; const q = Number((r as any).qty || 0);
      if (!Number.isFinite(q)) continue; openEffMap.set(k, (openEffMap.get(k) || 0) + q);
    }
  } catch {}

  await (prisma as any).$transaction(async (tx: any) => {
    for (const r of rows) {
      const { productKey: itemKey, closingQty, wasteQty } = r;
      const openEff = Number(openEffMap.get(itemKey) || 0);
      const maxClosing = Math.max(0, openEff - Number(wasteQty || 0));
      if (Number(closingQty || 0) > maxClosing + 1e-6) {
        const err: any = new Error(`Invalid closing for ${itemKey}: ${closingQty} > ${maxClosing}`);
        err.code = 400; throw err;
      }
      await tx.attendantClosing.upsert({
        where: { date_outletName_itemKey: { date, outletName, itemKey } },
        create: { date, outletName, itemKey, closingQty, wasteQty },
        update: { closingQty, wasteQty },
      });
    }
  });
}
