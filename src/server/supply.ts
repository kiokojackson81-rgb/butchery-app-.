// src/server/supply.ts
import { prisma } from "@/lib/prisma";

export type SupplySummaryLine = {
  itemKey: string;
  name: string;
  qty: number;
  unit: string;
  buyPrice: number;
};

export async function getTodaySupplySummary(outletName: string, date: string): Promise<SupplySummaryLine[]> {
  const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName, date } });
  if (!rows.length) return [];
  const keys = Array.from(new Set(rows.map((r: any) => r.itemKey).filter(Boolean)));
  const products = keys.length
    ? await (prisma as any).product.findMany({ where: { key: { in: keys } } })
    : [];
  const nameByKey = new Map<string, string>();
  for (const p of products as any[]) {
    if (p?.key) nameByKey.set(p.key, p.name || p.key);
  }
  return rows.map((r: any) => ({
    itemKey: r.itemKey,
    name: nameByKey.get(r.itemKey) || r.itemKey,
    qty: Number(r.qty || 0),
    unit: r.unit || "kg",
    buyPrice: Number(r.buyPrice || 0),
  }));
}
