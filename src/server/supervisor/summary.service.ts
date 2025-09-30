// src/server/supervisor/summary.service.ts
import { prisma } from "@/lib/db";
import { ZSummaryQuery } from "./supervisor.validation";
import { computeDayTotals } from "@/server/finance";
import { listProductsForOutlet } from "@/server/supplier/supplier.service";

export async function getOutletSummary(query: unknown) {
  const { date, outlet } = ZSummaryQuery.parse(query);

  const [openings, closings, expenses, deposits, transfers, products] = await Promise.all([
    (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet } }),
    (prisma as any).attendantClosing.findMany({ where: { date, outletName: outlet } }),
    (prisma as any).attendantExpense.findMany({ where: { date, outletName: outlet } }),
    (prisma as any).attendantDeposit.findMany({ where: { date, outletName: outlet } }),
    (prisma as any).supplyTransfer.findMany({ where: { date, OR: [{ fromOutletName: outlet }, { toOutletName: outlet }] } }),
    listProductsForOutlet(outlet),
  ]);

  const pmap = new Map((products as any).map((p: any) => [p.key, p]));
  const totals = await computeDayTotals({ date, outletName: outlet });

  return {
    date,
    outlet,
    openings: openings.map((r: any) => ({ itemKey: r.itemKey, qty: r.qty, unit: r.unit, buyPrice: r.buyPrice })),
    closings: closings.map((r: any) => ({ itemKey: r.itemKey, closingQty: r.closingQty, wasteQty: r.wasteQty })),
    expenses: expenses.map((e: any) => ({ name: e.name, amount: e.amount })),
    deposits: deposits.map((d: any) => ({ amount: d.amount, status: d.status })),
    transfers,
    totals,
    products: (products as any).map((p: any) => ({ key: p.key, name: p.name, unit: p.unit, sellPrice: p.sellPrice })),
    prettyName: (key: string) => (pmap.get(key) as any)?.name ?? key,
  };
}
