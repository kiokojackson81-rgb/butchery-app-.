import { prisma } from "@/lib/prisma";
import { isGeneralDepositAttendant } from "@/server/general_deposit";
import { APP_TZ, dateISOInTZ, addDaysISO } from "@/server/trading_period";
import { computeSnapshotTotals } from "@/server/finance";

/**
 * Compute amountToDeposit for an outlet for the current trading period, optionally
 * applying the special-general-attendant rules for the provided attendantCode.
 *
 * Contract:
 * - inputs: outletName (display string as used elsewhere), attendantCode (optional)
 * - output: amountToDeposit (number >= 0), along with a few helpful totals
 * - errors: best-effort; on any failure, returns zeros
 */
export async function computeAmountToDepositCurrent(opts: {
  outletName: string;
  attendantCode?: string | null;
}) {
  try {
    const outlet = String(opts.outletName || "");
    if (!outlet) return { amountToDeposit: 0, carryoverPrev: 0, todayTotalSales: 0, verifiedDeposits: 0, tillSalesGross: 0 };

    const tz = APP_TZ;
    const today = dateISOInTZ(new Date(), tz);

    // Gather inputs in parallel
    const [openRows, closingRows, pbRows, products, expenses, deposits, tillCountRows, snap1, snap2] = await Promise.all([
      prisma.supplyOpeningRow.findMany({ where: { date: today, outletName: outlet } }),
      prisma.attendantClosing.findMany({ where: { date: today, outletName: outlet } }),
      prisma.pricebookRow.findMany({ where: { outletName: outlet } }),
      prisma.product.findMany(),
      prisma.attendantExpense.findMany({ where: { date: today, outletName: outlet } }),
      prisma.$queryRaw`SELECT "id", "date", "outletName", "code", "note", "amount", "status", "createdAt" FROM "AttendantDeposit" WHERE "date"=${today} AND "outletName"=${outlet}` as any,
      prisma.$queryRaw`SELECT "counted" FROM "AttendantTillCount" WHERE "date"=${today} AND "outletName"=${outlet} LIMIT 1` as any,
      (prisma as any).setting.findUnique({ where: { key: `snapshot:closing:${today}:${outlet}:1` } }).catch(()=>null),
      (prisma as any).setting.findUnique({ where: { key: `snapshot:closing:${today}:${outlet}:2` } }).catch(()=>null),
    ]);

    // Resolve outlet to enum for Payment aggregate and current trading period window
    const allowedCodes = ["BRIGHT", "BARAKA_A", "BARAKA_B", "BARAKA_C", "GENERAL"] as const;
    const toEnum = (s: string | null | undefined) => {
      if (!s) return null as any;
      const c = String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      return (allowedCodes as readonly string[]).includes(c) ? (c as (typeof allowedCodes)[number]) : null;
    };
    let outletEnum: any = toEnum(outlet);
    if (!outletEnum) {
      const aliases: Record<string, string> = { BRIGHT: "BRIGHT", BARAKA: "BARAKA_A", BARAKA_A: "BARAKA_A", BARAKA_B: "BARAKA_B", BARAKA_C: "BARAKA_C", GENERAL: "GENERAL" };
      const c = String(outlet).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      if (aliases[c]) outletEnum = aliases[c];
    }

    // Current trading period window start
    let tillSalesGrossCurrent = 0;
    try {
      const active = await (prisma as any).activePeriod.findFirst({ where: { outletName: { equals: outlet, mode: 'insensitive' } } }).catch(() => null);
      let fromTime: Date | null = active?.periodStartAt ? new Date(active.periodStartAt) : null;
      if (!fromTime) {
        const fixedOffset = tz === "Africa/Nairobi" ? "+03:00" : "+00:00";
        fromTime = new Date(`${today}T00:00:00${fixedOffset}`);
      }
      const wherePayments: any = { outletCode: outletEnum, status: 'SUCCESS' };
      if (fromTime) wherePayments.createdAt = { gte: fromTime };
      const agg = await (prisma as any).payment.aggregate({ where: wherePayments, _sum: { amount: true } });
      tillSalesGrossCurrent = Number(agg?._sum?.amount || 0);
    } catch {}

    // Compute opening snapshot carryover using latest snapshot for today if present; else use yesterday
    const y = addDaysISO(today, -1, tz);
    const [yOpenRows, yClosingRows, yExpenses, yDeposits] = await Promise.all([
      prisma.supplyOpeningRow.findMany({ where: { date: y, outletName: outlet } }),
      prisma.attendantClosing.findMany({ where: { date: y, outletName: outlet } }),
      prisma.attendantExpense.findMany({ where: { date: y, outletName: outlet } }),
      prisma.$queryRaw`SELECT "id", "date", "outletName", "code", "note", "amount", "status", "createdAt" FROM "AttendantDeposit" WHERE "date"=${y} AND "outletName"=${outlet}` as any,
    ]);
    const pb = new Map(pbRows.map((r) => [`${r.productKey}`, r] as const));
    const prod = new Map(products.map((p) => [p.key, p] as const));
    const yClosingMap = new Map(yClosingRows.map((r) => [r.itemKey, r] as const));
    let yRevenue = 0;
    for (const row of yOpenRows) {
      const cl = yClosingMap.get(row.itemKey);
      const closing = cl?.closingQty || 0;
      const waste = cl?.wasteQty || 0;
      const soldQty = Math.max(0, (row.qty || 0) - closing - waste);
      const pbr = pb.get(row.itemKey as any) || pbRows.find((p) => `${p.productKey}` === row.itemKey);
      const price = pbr ? (pbr.active ? pbr.sellPrice : 0) : (products.find((p) => p.key === row.itemKey)?.active ? (products.find((p) => p.key === row.itemKey)?.sellPrice || 0) : 0);
      yRevenue += soldQty * price;
    }
    const yExpensesSum = yExpenses.reduce((a, e) => a + (e.amount || 0), 0);
    const yVerifiedDeposits = (yDeposits as any[]).filter((d) => d?.status !== "INVALID").reduce((a: number, d: any) => a + (Number(d?.amount || 0)), 0);
  // Preserve sign: allow surplus (negative outstandingPrev) so attendant UI can show Excess
  let outstandingPrev = (yRevenue - yExpensesSum - yVerifiedDeposits);
    const snapVal2: any = (snap2 as any)?.value || null;
    const snapVal1: any = (snap1 as any)?.value || null;
    const prevPeriodSnap: any = snapVal2 || snapVal1 || null;
    if (prevPeriodSnap && typeof prevPeriodSnap === 'object') {
      try {
        const openingSnapshot = (prevPeriodSnap.openingSnapshot || {}) as Record<string, number>;
        const clos = Array.isArray(prevPeriodSnap.closings) ? prevPeriodSnap.closings : [];
        const exps = Array.isArray(prevPeriodSnap.expenses) ? prevPeriodSnap.expenses : [];
        const totalsPrev = await computeSnapshotTotals({ outletName: outlet, openingSnapshot, closings: clos, expenses: exps, deposits });
        const verifiedDepositsPrev = (deposits || []).filter((d: any) => d.status !== "INVALID").reduce((a: number, d: any) => a + (Number(d?.amount) || 0), 0);
        const todayTotalPrev = Number(totalsPrev.expectedSales || 0) - Number(totalsPrev.expenses || 0);
        // Preserve sign so negative values indicate excess that can be applied to current period.
        outstandingPrev = (todayTotalPrev - verifiedDepositsPrev);
      } catch {}
    }

    // Compute today's sales/expenses
    const closingMap = new Map(closingRows.map((r) => [r.itemKey, r] as const));
    let weightSales = 0;
    for (const row of openRows) {
      const cl = closingMap.get(row.itemKey);
      const closing = cl?.closingQty || 0;
      const waste = cl?.wasteQty || 0;
      const soldQty = Math.max(0, (row.qty || 0) - closing - waste);
      const pbr = pb.get(row.itemKey as any) || pbRows.find((p) => `${p.productKey}` === row.itemKey);
      const price = pbr ? (pbr.active ? pbr.sellPrice : 0) : (products.find((p) => p.key === row.itemKey)?.active ? (products.find((p) => p.key === row.itemKey)?.sellPrice || 0) : 0);
      weightSales += soldQty * price;
    }
    const expensesSum = expenses.reduce((a, e) => a + (e.amount || 0), 0);
    const verifiedDeposits = (deposits as any[]).filter((d) => d?.status !== "INVALID").reduce((a: number, d: any) => a + (Number(d?.amount || 0)), 0);
    const todayTotalSales = weightSales - expensesSum;

    const isSpecial = await isGeneralDepositAttendant(opts.attendantCode).catch(()=>false);
    const amountToDeposit = isSpecial
      ? Number(outstandingPrev || 0) + Number(todayTotalSales || 0) - Number(verifiedDeposits || 0)
      : Number(outstandingPrev || 0) + Number(todayTotalSales || 0) - Number(verifiedDeposits || 0) - Number(tillSalesGrossCurrent || 0);

    return { amountToDeposit, carryoverPrev: outstandingPrev, todayTotalSales, verifiedDeposits, tillSalesGross: tillSalesGrossCurrent };
  } catch {
    return { amountToDeposit: 0, carryoverPrev: 0, todayTotalSales: 0, verifiedDeposits: 0, tillSalesGross: 0 };
  }
}
