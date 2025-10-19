// src/server/supervisor/summary.service.ts
import { prisma } from "@/lib/prisma";
import { ZSummaryQuery } from "./supervisor.validation";
import { computeDayTotals, computeSnapshotTotals } from "@/server/finance";
import { listProductsForOutlet } from "@/server/supplier/supplier.service";

export async function getOutletSummary(query: unknown) {
  const { date, outlet } = ZSummaryQuery.parse(query);

  const [openings, closings, expenses, deposits, transfers, products, periodSnap1, periodSnap2] = await Promise.all([
    (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet } }),
    (prisma as any).attendantClosing.findMany({ where: { date, outletName: outlet } }),
    (prisma as any).attendantExpense.findMany({ where: { date, outletName: outlet } }),
    (prisma as any).attendantDeposit.findMany({ where: { date, outletName: outlet } }),
    (prisma as any).supplyTransfer.findMany({ where: { date, OR: [{ fromOutletName: outlet }, { toOutletName: outlet }] } }),
    listProductsForOutlet(outlet),
    // Period snapshots written by /api/period/start on first/second close
    (prisma as any).setting.findUnique({ where: { key: `snapshot:closing:${date}:${outlet}:1` } }).catch(()=>null),
    (prisma as any).setting.findUnique({ where: { key: `snapshot:closing:${date}:${outlet}:2` } }).catch(()=>null),
  ]);

  const pmap = new Map((products as any).map((p: any) => [p.key, p]));
  // Default: live day totals
  let totals = await computeDayTotals({ date, outletName: outlet });
  // If live closings were cleared after first-close rotation, fallback to snapshot computation
  try {
    const hasLiveClosings = Array.isArray(closings) && closings.length > 0;
    const snap = (periodSnap2 as any)?.value || (periodSnap1 as any)?.value || null;
    if (!hasLiveClosings && snap && typeof snap === 'object') {
      const openingSnapshot = (snap as any).openingSnapshot || {};
      const clos = Array.isArray((snap as any).closings) ? (snap as any).closings : [];
      const exps = Array.isArray((snap as any).expenses) ? (snap as any).expenses : [];
      totals = await computeSnapshotTotals({ outletName: outlet, openingSnapshot, closings: clos, expenses: exps, deposits });
    }
  } catch {}

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
