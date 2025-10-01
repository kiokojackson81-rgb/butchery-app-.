// src/server/supply.ts
import { prisma } from "@/lib/prisma";

export async function getTodaySupplySummary(outletName: string, date: string) {
  const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName, date } });
  return rows.map((r: any) => ({ productKey: r.itemKey, qty: Number(r.qty || 0), unit: r.unit || "kg" }));
}
