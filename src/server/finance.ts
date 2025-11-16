// src/server/finance.ts
import { prisma } from "@/lib/prisma";

function prevDateISO(d: string) {
  const dt = new Date(d + "T00:00:00.000Z");
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export async function computeDayTotals(args: { date: string; outletName: string }) {
  const { date, outletName } = args;
  const [supplyRows, closingRows, pbRows, products, expenses, deposits, payments] = await Promise.all([
    (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName } }),
    (prisma as any).attendantClosing.findMany({ where: { date, outletName } }),
    (prisma as any).pricebookRow.findMany({ where: { outletName } }),
    (prisma as any).product.findMany(),
    (prisma as any).attendantExpense.findMany({ where: { date, outletName } }),
    (prisma as any).attendantDeposit.findMany({ where: { date, outletName } }),
    // Till payments gross (SUCCESS only) for expectedDeposit net calc
    (async () => {
      try {
        const start = new Date(date + 'T00:00:00.000Z');
        const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
        return await (prisma as any).payment.findMany({
          where: {
            outletName,
            status: 'SUCCESS',
            createdAt: { gte: start, lt: end }
          }
        });
      } catch { return []; }
    })(),
  ]);

  const pb = new Map<any, any>(pbRows.map((r: any) => [`${r.productKey}`, r] as const));
  const prod = new Map<any, any>(products.map((p: any) => [p.key, p] as const));
  const closingMap = new Map<any, any>(closingRows.map((r: any) => [r.itemKey, r] as const));

  // Opening-effective: yesterday closing + today's supply
  const openMap = new Map<string, number>();
  const y = prevDateISO(date);
  const prev = await (prisma as any).attendantClosing.findMany({ where: { date: y, outletName } });
  for (const r of prev || []) {
    const key = (r as any).itemKey;
    const qty = Number((r as any).closingQty || 0);
    if (!Number.isFinite(qty)) continue;
    openMap.set(key, (openMap.get(key) || 0) + qty);
  }
  for (const r of supplyRows || []) {
    const key = (r as any).itemKey;
    const qty = Number((r as any).qty || 0);
    if (!Number.isFinite(qty)) continue;
    openMap.set(key, (openMap.get(key) || 0) + qty);
  }

  let weightSales = 0;
  for (const [itemKey, openingQty] of openMap.entries()) {
    const cl: any = closingMap.get(itemKey) || {};
    const closing = Number(cl?.closingQty || 0);
    const waste = Number(cl?.wasteQty || 0);
    // Adjusted business logic: do NOT subtract waste when computing soldQty (align with potatoes logic)
    const soldQty = Math.max(0, (openingQty || 0) - closing);
    const pbr: any = pb.get(itemKey) || null;
    const prodRow: any = prod.get(itemKey) || null;
    const price = pbr ? (pbr.active ? pbr.sellPrice : 0) : prodRow?.active ? prodRow?.sellPrice || 0 : 0;
    weightSales += soldQty * price;
  }

  // Potatoes-specific expected deposit logic
  // Formula (per business rule):
  // sales_qty = (yesterday closing + today supply) - today closing  [do NOT subtract waste]
  // expected_deposit = sales_qty * 0.75 * 130
  let potatoesExpectedDeposit = 0;
  try {
    const POTATOES_KEY = "potatoes";
    const openPotatoes = Number(openMap.get(POTATOES_KEY) || 0);
    const clPot: any = closingMap.get(POTATOES_KEY) || {};
    const closingPot = Number(clPot?.closingQty || 0);
    const soldNoWaste = Math.max(0, openPotatoes - closingPot);
    const yieldFactor = 0.75; // 75% yield
    const rateKsh = 130;      // Ksh per kg
    potatoesExpectedDeposit = soldNoWaste * yieldFactor * rateKsh;
  } catch {}

  const expensesSum = expenses.reduce((a: number, e: any) => a + (e.amount || 0), 0);
  const tillSalesGross = (payments || []).reduce((a: number, p: any) => a + (Number(p?.amount) || 0), 0);
  const verifiedDeposits = deposits.filter((d: any) => d.status !== "INVALID").reduce((a: number, d: any) => a + (d.amount || 0), 0);
  const todayTotalSales = weightSales - expensesSum;
  const netTill = tillSalesGross - verifiedDeposits;
  const expectedDeposit = todayTotalSales - netTill;

  const result = { expectedSales: weightSales, expenses: expensesSum, wasteValue: 0, expectedDeposit, potatoesExpectedDeposit, tillSalesGross, verifiedDeposits };
  if (process.env.SUPERVISOR_DIAG) {
    try {
      console.error('[computeDayTotals debug inputs]', {
        outletName,
        date,
        supplyCount: supplyRows.length,
        closingCount: closingRows.length,
        expenseCount: expenses.length,
        depositCount: deposits.length,
        paymentCount: (payments||[]).length,
        pricebookActive: pbRows.filter((r:any)=>r.active).length,
        productActive: products.filter((p:any)=>p.active).length,
        sampleClosing: closingRows.slice(0,3).map((r:any)=>({ itemKey: r.itemKey, closingQty: r.closingQty, wasteQty: r.wasteQty }))
      });
      console.error('[computeDayTotals debug result]', JSON.stringify(result));
    } catch {}
  }
  return result;
}

// Compute totals for a closed period from a saved snapshot (used after first close when live rows were cleared)
export async function computeSnapshotTotals(args: {
  outletName: string;
  openingSnapshot: Record<string, number>;
  closings: Array<{ itemKey: string; closingQty: number; wasteQty: number }>;
  expenses?: Array<{ amount: number }>;
  deposits?: Array<{ amount: number; status?: string }>;
}) {
  const { outletName, openingSnapshot, closings, expenses = [], deposits = [] } = args;

  const [pbRows, products] = await Promise.all([
    (prisma as any).pricebookRow.findMany({ where: { outletName } }),
    (prisma as any).product.findMany(),
  ]);

  // Debug: surface what's being used during tests when weightSales is unexpectedly zero

  const pb = new Map<any, any>(pbRows.map((r: any) => [`${r.productKey}`, r] as const));
  const prod = new Map<any, any>(products.map((p: any) => [p.key, p] as const));
  const closingMap = new Map<any, any>(closings.map((r: any) => [r.itemKey, r] as const));

  let weightSales = 0;
  // Fallback: if openingSnapshot empty but closings exist, derive a synthetic opening from closing + waste (visibility only)
  let effectiveOpening = openingSnapshot;
  if ((!openingSnapshot || Object.keys(openingSnapshot).length === 0) && closings.length > 0) {
    effectiveOpening = {};
    for (const c of closings) {
      const base = Number(c.closingQty || 0) + Number(c.wasteQty || 0);
      if (base > 0) (effectiveOpening as any)[c.itemKey] = base;
    }
  if (process.env.SUPERVISOR_DIAG) { try { console.error('[computeSnapshotTotals debug] applied synthetic opening from closings'); } catch {} }
  }

  for (const [itemKey, openingQtyRaw] of Object.entries(effectiveOpening || {})) {
    const openingQty = Number(openingQtyRaw || 0);
    if (!Number.isFinite(openingQty) || openingQty <= 0) continue;
    const cl: any = closingMap.get(itemKey) || {};
    const closing = Number(cl?.closingQty || 0);
    const waste = Number(cl?.wasteQty || 0);
    // Adjusted logic: do NOT subtract waste when computing soldQty
    const soldQty = Math.max(0, openingQty - closing);
    const pbr: any = pb.get(itemKey) || null;
    const prodRow: any = prod.get(itemKey) || null;
    const price = pbr ? (pbr.active ? pbr.sellPrice : 0) : prodRow?.active ? prodRow?.sellPrice || 0 : 0;
    weightSales += soldQty * price;
  }

  // Potatoes-specific expected deposit (from snapshot): sales_qty = opening - closing (do not subtract waste)
  let potatoesExpectedDeposit = 0;
  try {
    const POTATOES_KEY = "potatoes";
    const openPotatoes = Number((openingSnapshot as any)[POTATOES_KEY] || 0);
    const clPot: any = closingMap.get(POTATOES_KEY) || {};
    const closingPot = Number(clPot?.closingQty || 0);
    const soldNoWaste = Math.max(0, openPotatoes - closingPot);
    const yieldFactor = 0.75; // 75% yield
    const rateKsh = 130;      // Ksh per kg
    potatoesExpectedDeposit = soldNoWaste * yieldFactor * rateKsh;
  } catch {}

  const expensesSum = (expenses || []).reduce((a: number, e: any) => a + (Number(e?.amount) || 0), 0);
  const tillSalesGross = 0; // Not available in snapshot context (period aggregate); supply via extended args if needed.
  const verifiedDeposits = (deposits || []).filter((d: any) => d.status !== "INVALID").reduce((a: number, d: any) => a + (Number(d?.amount) || 0), 0);
  const todayTotalSales = weightSales - expensesSum;
  const netTill = tillSalesGross - verifiedDeposits;
  const expectedDeposit = todayTotalSales - netTill;

    const result = { expectedSales: weightSales, expenses: expensesSum, wasteValue: 0, expectedDeposit, potatoesExpectedDeposit, tillSalesGross, verifiedDeposits };
    if (process.env.SUPERVISOR_DIAG) {
      try {
        console.error('[computeSnapshotTotals debug inputs]', {
          outletName,
          openingKeys: Object.keys(effectiveOpening || {}).length,
          closingCount: closings.length,
          expenseCount: expenses.length,
          depositCount: deposits.length,
          pricebookActive: pbRows.filter((r:any)=>r.active).length,
          productActive: products.filter((p:any)=>p.active).length,
          sampleClosing: closings.slice(0,3).map(r=>({ itemKey: r.itemKey, closingQty: r.closingQty, wasteQty: r.wasteQty }))
        });
        console.error('[computeSnapshotTotals debug result]', JSON.stringify(result));
      } catch {}
    }
    return result;
}
