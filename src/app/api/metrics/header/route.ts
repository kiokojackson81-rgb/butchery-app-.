import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { APP_TZ, dateISOInTZ, addDaysISO } from "@/server/trading_period";
import { computeSnapshotTotals } from "@/server/finance";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outlet = searchParams.get("outlet") || "";
  const tz = APP_TZ;
  const dateParam = (searchParams.get("date") || "").slice(0, 10);
  const today = dateISOInTZ(new Date(), tz);
  const date = dateParam || today;
  const period = (searchParams.get("period") || "").toLowerCase(); // "previous" to show previous trading period for given date
  const isCurrent = !dateParam || dateParam === today;
  if (!outlet)
    return NextResponse.json({
      ok: true,
      totals: {
        weightSales: 0,
        expenses: 0,
        todayTotalSales: 0,
        tillSalesGross: 0,
        verifiedDeposits: 0,
        netTill: 0,
        amountToDeposit: 0,
      },
    });

  const [openRows, closingRows, pbRows, products, expenses, deposits, tillCountRows, snap1, snap2] = await Promise.all([
    prisma.supplyOpeningRow.findMany({ where: { date, outletName: outlet } }),
    prisma.attendantClosing.findMany({ where: { date, outletName: outlet } }),
    prisma.pricebookRow.findMany({ where: { outletName: outlet } }),
    prisma.product.findMany(),
    prisma.attendantExpense.findMany({ where: { date, outletName: outlet } }),
    prisma.attendantDeposit.findMany({ where: { date, outletName: outlet } }),
    // Till count (optional) — use raw to avoid Prisma client mismatches on some environments
    prisma.$queryRaw`SELECT "counted" FROM "AttendantTillCount" WHERE "date"=${date} AND "outletName"=${outlet} LIMIT 1` as any,
    // Period snapshots saved by /api/period/start on first/second close
    (prisma as any).setting.findUnique({ where: { key: `snapshot:closing:${date}:${outlet}:1` } }).catch(()=>null),
    (prisma as any).setting.findUnique({ where: { key: `snapshot:closing:${date}:${outlet}:2` } }).catch(()=>null),
  ]);

  const pb = new Map(pbRows.map((r) => [`${r.productKey}`, r] as const));
  const prod = new Map(products.map((p) => [p.key, p] as const));
  const closingMap = new Map(closingRows.map((r) => [r.itemKey, r] as const));

  // Compute previous period/day carryover regardless, used even when we gate Current totals to zero
  const y = addDaysISO(date, -1, tz);
  const [yOpenRows, yClosingRows, yExpenses, yDeposits] = await Promise.all([
    prisma.supplyOpeningRow.findMany({ where: { date: y, outletName: outlet } }),
    prisma.attendantClosing.findMany({ where: { date: y, outletName: outlet } }),
    prisma.attendantExpense.findMany({ where: { date: y, outletName: outlet } }),
    prisma.attendantDeposit.findMany({ where: { date: y, outletName: outlet } }),
  ]);
  const yClosingMap = new Map(yClosingRows.map((r) => [r.itemKey, r] as const));
  let yRevenue = 0;
  for (const row of yOpenRows) {
    const cl = yClosingMap.get(row.itemKey);
    const closing = cl?.closingQty || 0;
    const waste = cl?.wasteQty || 0;
    const soldQty = Math.max(0, (row.qty || 0) - closing - waste);
    const pbr = pbRows.find((p) => `${p.productKey}` === row.itemKey);
    const price = pbr ? (pbr.active ? pbr.sellPrice : 0) : (products.find((p) => p.key === row.itemKey)?.active ? (products.find((p) => p.key === row.itemKey)?.sellPrice || 0) : 0);
    yRevenue += soldQty * price;
  }
  const yExpensesSum = yExpenses.reduce((a, e) => a + (e.amount || 0), 0);
  const yVerifiedDeposits = yDeposits.filter((d) => d.status !== "INVALID").reduce((a, d) => a + (d.amount || 0), 0);
  let outstandingPrev = Math.max(0, yRevenue - yExpensesSum - yVerifiedDeposits);
  // If there is a snapshot for the same date (today), treat that snapshot as the previous trading period when viewing Current.
  // This makes carryover available immediately after the first close.
  const snapVal2: any = (snap2 as any)?.value || null;
  const snapVal1: any = (snap1 as any)?.value || null;
  const prevPeriodSnap: any = snapVal2 || snapVal1 || null;
  if (isCurrent && prevPeriodSnap && typeof prevPeriodSnap === 'object') {
    try {
      const openingSnapshot = (prevPeriodSnap.openingSnapshot || {}) as Record<string, number>;
      const clos = Array.isArray(prevPeriodSnap.closings) ? prevPeriodSnap.closings : [];
      const exps = Array.isArray(prevPeriodSnap.expenses) ? prevPeriodSnap.expenses : [];
      const totalsPrev = await computeSnapshotTotals({ outletName: outlet, openingSnapshot, closings: clos, expenses: exps, deposits });
      const verifiedDepositsPrev = (deposits || []).filter((d: any) => d.status !== "INVALID").reduce((a: number, d: any) => a + (Number(d?.amount) || 0), 0);
      const todayTotalPrev = Number(totalsPrev.expectedSales || 0) - Number(totalsPrev.expenses || 0);
      outstandingPrev = Math.max(0, todayTotalPrev - verifiedDepositsPrev);
    } catch {}
  }

  // If this is Current day and there's no activity yet, gate totals to zero to avoid inflating from opening stock
  const hasTill = Array.isArray(tillCountRows) && tillCountRows.length > 0 && Number((tillCountRows as any)[0]?.counted || 0) > 0;
  const hasActivity = (closingRows.length > 0) || (expenses.length > 0) || (deposits.length > 0) || hasTill;
  if (isCurrent && !hasActivity) {
    return NextResponse.json({
      ok: true,
      totals: {
        weightSales: 0,
        expenses: 0,
        todayTotalSales: 0,
        tillSalesGross: 0,
        verifiedDeposits: 0,
        netTill: 0,
        // Show outstanding from the previously closed period immediately (snapshot if available, else yesterday)
        carryoverPrev: outstandingPrev,
        amountToDeposit: outstandingPrev,
      },
    });
  }

  // Previous period view for the given date: use latest snapshot on that date if present
  if (period === 'previous') {
    if (prevPeriodSnap && typeof prevPeriodSnap === 'object') {
      try {
        const openingSnapshot = (prevPeriodSnap.openingSnapshot || {}) as Record<string, number>;
        const clos = Array.isArray(prevPeriodSnap.closings) ? prevPeriodSnap.closings : [];
        const exps = Array.isArray(prevPeriodSnap.expenses) ? prevPeriodSnap.expenses : [];
        const totalsPrev = await computeSnapshotTotals({ outletName: outlet, openingSnapshot, closings: clos, expenses: exps, deposits });
        const verifiedDepositsPrev = (deposits || []).filter((d: any) => d.status !== "INVALID").reduce((a: number, d: any) => a + (Number(d?.amount) || 0), 0);
        const todayTotalPrev = Number(totalsPrev.expectedSales || 0) - Number(totalsPrev.expenses || 0);
        const amountToDepositPrev = outstandingPrev + (todayTotalPrev - verifiedDepositsPrev);
        return NextResponse.json({
          ok: true,
          totals: {
            weightSales: Number(totalsPrev.expectedSales || 0),
            expenses: Number(totalsPrev.expenses || 0),
            todayTotalSales: todayTotalPrev,
            tillSalesGross: 0,
            verifiedDeposits: verifiedDepositsPrev,
            netTill: 0,
            carryoverPrev: outstandingPrev,
            amountToDeposit: amountToDepositPrev,
          },
        });
      } catch {}
    }
    // Fallback behavior: treat "previous" as calendar previous day
    return NextResponse.json({
      ok: true,
      totals: {
        weightSales: 0,
        expenses: yExpensesSum,
        todayTotalSales: Math.max(0, yRevenue - yExpensesSum),
        tillSalesGross: 0,
        verifiedDeposits: yVerifiedDeposits,
        netTill: 0,
        carryoverPrev: 0,
        amountToDeposit: Math.max(0, yRevenue - yExpensesSum - yVerifiedDeposits),
      },
    });
  }

  let weightSales = 0;

  for (const row of openRows) {
    const cl = closingMap.get(row.itemKey);
    const closing = cl?.closingQty || 0;
    const waste = cl?.wasteQty || 0;
    const soldQty = Math.max(0, (row.qty || 0) - closing - waste);

    // price: pricebook active else product active
    const pbr = pb.get(row.itemKey);
    const price = pbr ? (pbr.active ? pbr.sellPrice : 0) : prod.get(row.itemKey)?.active ? prod.get(row.itemKey)?.sellPrice || 0 : 0;

    weightSales += soldQty * price;
  }

  const expensesSum = expenses.reduce((a, e) => a + (e.amount || 0), 0);
  const tillSalesGross = 0; // hook up to POS later if needed
  const verifiedDeposits = deposits.filter((d) => d.status !== "INVALID").reduce((a, d) => a + (d.amount || 0), 0);

  const todayTotalSales = weightSales - expensesSum;
  const netTill = tillSalesGross - verifiedDeposits;

  // pb/prod maps reused below; outstandingPrev already computed above

  // Inclusive amount to deposit: carryover + today's to-deposit (todayTotalSales - verifiedDeposits)
  const amountToDeposit = outstandingPrev + (todayTotalSales - verifiedDeposits);

  return NextResponse.json({
    ok: true,
    totals: {
      weightSales,
      expenses: expensesSum,
      todayTotalSales,
      tillSalesGross,
      verifiedDeposits,
      netTill,
      carryoverPrev: outstandingPrev,
      amountToDeposit,
    },
  });
}
