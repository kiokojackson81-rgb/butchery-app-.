// src/server/finance.ts
import { prisma } from "@/lib/prisma";

function prevDateISO(d: string) {
  const dt = new Date(d + "T00:00:00.000Z");
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export async function computeDayTotals(args: { date: string; outletName: string }) {
  const { date, outletName } = args;
  const [openRowsRaw, closingRows, pbRows, products, expenses, deposits] = await Promise.all([
    (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName } }),
    (prisma as any).attendantClosing.findMany({ where: { date, outletName } }),
    (prisma as any).pricebookRow.findMany({ where: { outletName } }),
    (prisma as any).product.findMany(),
    (prisma as any).attendantExpense.findMany({ where: { date, outletName } }),
    (prisma as any).attendantDeposit.findMany({ where: { date, outletName } }),
  ]);

  const pb = new Map<any, any>(pbRows.map((r: any) => [`${r.productKey}`, r] as const));
  const prod = new Map<any, any>(products.map((p: any) => [p.key, p] as const));
  const closingMap = new Map<any, any>(closingRows.map((r: any) => [r.itemKey, r] as const));

  // Opening logic: prefer today's supply; if none, fall back to yesterday's closing as opening
  let openRows: Array<{ itemKey: string; qty: number; unit?: string }> = openRowsRaw.map((r: any) => ({ itemKey: r.itemKey, qty: Number(r.qty || 0), unit: r.unit }));
  if (!openRows.length) {
    const y = prevDateISO(date);
    const prev = await (prisma as any).attendantClosing.findMany({ where: { date: y, outletName } });
    openRows = prev.map((r: any) => ({ itemKey: r.itemKey, qty: Number(r.closingQty || 0), unit: (prod.get(r.itemKey) as any)?.unit || "kg" }));
  }

  let weightSales = 0;
  for (const row of openRows) {
    const cl: any = closingMap.get(row.itemKey) || {};
    const closing = Number(cl?.closingQty || 0);
    const waste = Number(cl?.wasteQty || 0);
    const soldQty = Math.max(0, (row.qty || 0) - closing - waste);
    const pbr: any = pb.get(row.itemKey) || null;
    const prodRow: any = prod.get(row.itemKey) || null;
    const price = pbr ? (pbr.active ? pbr.sellPrice : 0) : prodRow?.active ? prodRow?.sellPrice || 0 : 0;
    weightSales += soldQty * price;
  }

  const expensesSum = expenses.reduce((a: number, e: any) => a + (e.amount || 0), 0);
  const tillSalesGross = 0;
  const verifiedDeposits = deposits.filter((d: any) => d.status !== "INVALID").reduce((a: number, d: any) => a + (d.amount || 0), 0);
  const todayTotalSales = weightSales - expensesSum;
  const netTill = tillSalesGross - verifiedDeposits;
  const expectedDeposit = todayTotalSales - netTill;

  return { expectedSales: weightSales, expenses: expensesSum, wasteValue: 0, expectedDeposit };
}
