// src/server/finance.ts
import { prisma } from "@/lib/prisma";

export async function computeDayTotals(args: { date: string; outletName: string }) {
  const { date, outletName } = args;
  const [openRows, closingRows, pbRows, products, expenses, deposits] = await Promise.all([
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
