import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { isGeneralDepositAttendant } from "@/server/general_deposit";
import { computeAssistantExpectedDeposit, isAssistant } from "@/server/assistant";
import { APP_TZ, dateISOInTZ, addDaysISO } from "@/server/trading_period";
import { computeSnapshotTotals } from "@/server/finance";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outlet = searchParams.get("outlet") || "";
  const attendantCode = (searchParams.get("attendant") || searchParams.get("attendantCode") || "").toString();
  const tz = APP_TZ;
  const dateParam = (searchParams.get("date") || "").slice(0, 10);
  const today = dateISOInTZ(new Date(), tz);
  const date = dateParam || today;
  const periodParam = searchParams.get("period");
  const isCurrent = !dateParam || dateParam === today;
  // Default behavior tweak:
  // - If the request targets today (no date param OR date == today), default to CURRENT period unless explicitly overridden.
  // - If the request targets any other date, default to PREVIOUS period unless explicitly overridden.
  const period = (periodParam || (isCurrent ? 'current' : 'previous')).toLowerCase();
  const assistantCode = (attendantCode || "").trim();
  const assistantMode = assistantCode ? await isAssistant(assistantCode) : false;
  if (assistantMode) {
    const calc = await computeAssistantExpectedDeposit({ code: assistantCode, date, outletName: outlet || null });
    return NextResponse.json({
      ok: calc.ok,
      totals: {
        weightSales: calc.salesValue,
        expenses: calc.expensesValue,
        todayTotalSales: calc.expected,
        tillSalesGross: 0,
        todayTillSales: 0,
        verifiedDeposits: calc.depositedSoFar,
        netTill: 0,
        openingValue: 0,
        carryoverPrev: calc.carryoverPrev,
        amountToDeposit: calc.recommendedNow,
      },
      assistant: {
        expected: calc.expected,
        carryoverPrev: calc.carryoverPrev,
        recommendedNow: calc.recommendedNow,
        depositedSoFar: calc.depositedSoFar,
        salesValue: calc.salesValue,
        expensesValue: calc.expensesValue,
        periodState: calc.periodState,
        warnings: calc.warnings,
        breakdown: calc.breakdownByProduct,
      },
    });
  }
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
    prisma.supplyOpeningRow.findMany({ where: { date, outletName: outlet }, select: { itemKey: true, qty: true } }),
    prisma.attendantClosing.findMany({ where: { date, outletName: outlet } }),
    prisma.pricebookRow.findMany({ where: { outletName: { equals: outlet, mode: 'insensitive' } } }),
    prisma.product.findMany(),
    prisma.attendantExpense.findMany({ where: { date, outletName: outlet } }),
    // Use raw SQL to avoid selecting a column that might be missing in some DB states (verifyPayload)
    prisma.$queryRaw`SELECT "id", "date", "outletName", "code", "note", "amount", "status", "createdAt" FROM "AttendantDeposit" WHERE "date"=${date} AND "outletName"=${outlet}` as any,
    // Till count (optional) — use raw to avoid Prisma client mismatches on some environments
    prisma.$queryRaw`SELECT "counted" FROM "AttendantTillCount" WHERE "date"=${date} AND "outletName"=${outlet} LIMIT 1` as any,
    // Period snapshots saved by /api/period/start on first/second close
    (prisma as any).setting.findUnique({ where: { key: `snapshot:closing:${date}:${outlet}:1` } }).catch(()=>null),
    (prisma as any).setting.findUnique({ where: { key: `snapshot:closing:${date}:${outlet}:2` } }).catch(()=>null),
  ]);

  // Case-insensitive maps for product lookups
  const pbLC = new Map<string, typeof pbRows[number]>(pbRows.map((r) => [String(r.productKey).toLowerCase(), r]));
  const prodLC = new Map<string, typeof products[number]>(products.map((p) => [String(p.key).toLowerCase(), p]));
  const closingMap = new Map(closingRows.map((r) => [r.itemKey, r] as const));

  // --- Till Payments (Gross) for CURRENT trading period ---
  // Normalize outlet name to Prisma enum OutletCode for Payment table
  const allowedCodes = ["BRIGHT", "BARAKA_A", "BARAKA_B", "BARAKA_C", "GENERAL"] as const;
  const toEnum = (s: string | null | undefined) => {
    if (!s) return null;
    const c = String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    return (allowedCodes as readonly string[]).includes(c) ? (c as typeof allowedCodes[number]) : null;
  };
  let outletEnum = toEnum(outlet) as any;
  if (!outletEnum) {
    const aliases: Record<string, string> = { BRIGHT: "BRIGHT", BARAKA: "BARAKA_A", BARAKA_A: "BARAKA_A", BARAKA_B: "BARAKA_B", BARAKA_C: "BARAKA_C", GENERAL: "GENERAL" };
    const c = String(outlet).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    if (aliases[c]) outletEnum = aliases[c];
  }

  let tillSalesGrossCurrent = 0;
  try {
    if (period !== 'previous' && outletEnum) {
      // Establish current trading period window start
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
    }
  } catch {}

  // Compute previous period/day carryover regardless, used even when we gate Current totals to zero
  const y = addDaysISO(date, -1, tz);
  const [yOpenRows, yClosingRows, yExpenses, yDeposits] = await Promise.all([
    prisma.supplyOpeningRow.findMany({ where: { date: y, outletName: outlet }, select: { itemKey: true, qty: true } }),
    prisma.attendantClosing.findMany({ where: { date: y, outletName: outlet } }),
    prisma.attendantExpense.findMany({ where: { date: y, outletName: outlet } }),
    prisma.$queryRaw`SELECT "id", "date", "outletName", "code", "note", "amount", "status", "createdAt" FROM "AttendantDeposit" WHERE "date"=${y} AND "outletName"=${outlet}` as any,
  ]);
  const yClosingMap = new Map(yClosingRows.map((r) => [r.itemKey, r] as const));
  let yRevenue = 0;
  for (const row of yOpenRows) {
    const cl = yClosingMap.get(row.itemKey);
    const closing = cl?.closingQty || 0;
    const waste = cl?.wasteQty || 0;
    const soldQty = Math.max(0, (row.qty || 0) - closing - waste);
    const keyLc = String(row.itemKey).toLowerCase();
    const pbr = pbLC.get(keyLc);
    const price = pbr
      ? (pbr.active ? Number(pbr.sellPrice || 0) : 0)
      : (() => {
          const prod = prodLC.get(keyLc);
          return prod && prod.active ? Number(prod.sellPrice || 0) : 0;
        })();
    yRevenue += soldQty * price;
  }
  const yExpensesSum = yExpenses.reduce((a, e) => a + (e.amount || 0), 0);
  const yVerifiedDeposits = (yDeposits as any[]).filter((d) => d?.status !== "INVALID").reduce((a: number, d: any) => a + (Number(d?.amount || 0)), 0);
  // Do not clamp here: allow negative values (surplus/excess) so they can be shown
  // as 'Excess' in the attendant dashboard when appropriate.
  let outstandingPrev = (yRevenue - yExpensesSum - yVerifiedDeposits);
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
        // If the snapshot contains its own deposits, use them when computing previous-period totals.
        const snapDeposits = Array.isArray(prevPeriodSnap.deposits) ? prevPeriodSnap.deposits : [];
        const totalsPrev = await computeSnapshotTotals({ outletName: outlet, openingSnapshot, closings: clos, expenses: exps, deposits: snapDeposits });
      const verifiedDepositsPrev = (snapDeposits || []).filter((d: any) => d.status !== "INVALID").reduce((a: number, d: any) => a + (Number(d?.amount || 0) || 0), 0);
      const todayTotalPrev = Number(totalsPrev.expectedSales || 0) - Number(totalsPrev.expenses || 0);
      // Preserve sign here as well: a negative value indicates an excess/surplus to carry forward.
      outstandingPrev = (todayTotalPrev - verifiedDepositsPrev);
    } catch {}
  }

  // Pre-compute opening value (qty × price) for the date; useful to display supply value when no activity yet
  let openingValueGross = 0;
  try {
    for (const row of openRows) {
      const keyLc = String(row.itemKey).toLowerCase();
      const pbr = pbLC.get(keyLc);
      const price = pbr
        ? (pbr.active ? Number(pbr.sellPrice || 0) : 0)
        : (() => {
            const prod = prodLC.get(keyLc);
            return prod && prod.active ? Number(prod.sellPrice || 0) : 0;
          })();
      openingValueGross += (Number(row.qty || 0) || 0) * (Number(price || 0) || 0);
    }
  } catch {}

  // Previous period view for the given date: use latest snapshot on that date if present
  if (period === 'previous') {
    // If there is a saved snapshot for the date, compute totals from the snapshot
    if (prevPeriodSnap && typeof prevPeriodSnap === 'object') {
      try {
        const openingSnapshot = (prevPeriodSnap.openingSnapshot || {}) as Record<string, number>;
        const clos = Array.isArray(prevPeriodSnap.closings) ? prevPeriodSnap.closings : [];
        const exps = Array.isArray(prevPeriodSnap.expenses) ? prevPeriodSnap.expenses : [];
        const snapDeposits = Array.isArray(prevPeriodSnap.deposits) ? prevPeriodSnap.deposits : [];
        const totalsPrev = await computeSnapshotTotals({ outletName: outlet, openingSnapshot, closings: clos, expenses: exps, deposits: snapDeposits });
        const verifiedDepositsPrev = (snapDeposits || []).filter((d: any) => d.status !== 'INVALID').reduce((a: number, d: any) => a + (Number(d?.amount) || 0), 0);
        const todayTotalPrev = Number(totalsPrev.expectedSales || 0) - Number(totalsPrev.expenses || 0);
        // For explicit "previous" view, use the previous calendar day's carryover (yRevenue - yExpenses - yVerifiedDeposits)
        const carryoverPrevFromY = Math.max(0, yRevenue - yExpensesSum - yVerifiedDeposits);
        const amountToDepositPrev = carryoverPrevFromY + (todayTotalPrev - verifiedDepositsPrev);

        return NextResponse.json({
          ok: true,
          totals: {
            weightSales: Number(totalsPrev.expectedSales || 0),
            expenses: Number(totalsPrev.expenses || 0),
            todayTotalSales: todayTotalPrev,
            tillSalesGross: 0,
            todayTillSales: 0,
            verifiedDeposits: verifiedDepositsPrev,
            netTill: 0,
            carryoverPrev: carryoverPrevFromY,
            amountToDeposit: amountToDepositPrev,
          },
        });
      } catch (err) {
        // If snapshot computation fails, fall through to calendar-previous fallback below
      }
    }

    // Fallback behavior: treat "previous" as calendar previous day
    return NextResponse.json({
      ok: true,
      totals: {
        weightSales: 0,
        expenses: yExpensesSum,
        todayTotalSales: Math.max(0, yRevenue - yExpensesSum),
        tillSalesGross: 0,
        todayTillSales: 0,
        verifiedDeposits: yVerifiedDeposits,
        netTill: 0,
        carryoverPrev: 0,
        amountToDeposit: Math.max(0, yRevenue - yExpensesSum - yVerifiedDeposits),
      },
    });
  }

  // If this is Current day and there's no activity yet, gate totals to zero to avoid inflating from opening stock
  const hasTill = Array.isArray(tillCountRows) && tillCountRows.length > 0 && Number((tillCountRows as any)[0]?.counted || 0) > 0;
  const hasActivity = (closingRows.length > 0) || (expenses.length > 0) || (deposits.length > 0) || hasTill;
  const isSpecial = await isGeneralDepositAttendant(attendantCode).catch(()=>false);
  if (isCurrent && !hasActivity) {
    return NextResponse.json({
      ok: true,
      totals: {
        weightSales: 0,
        expenses: 0,
        todayTotalSales: 0,
        tillSalesGross: tillSalesGrossCurrent,
        todayTillSales: tillSalesGrossCurrent,
        verifiedDeposits: 0,
        netTill: 0,
        openingValue: openingValueGross,
        // Show outstanding from the previously closed period immediately (snapshot if available, else yesterday)
        carryoverPrev: outstandingPrev,
        // Special attendants: do NOT subtract till sales because their sales require direct deposits
        amountToDeposit: isSpecial
          ? Number(outstandingPrev || 0)
          : Number(outstandingPrev || 0) - Number(tillSalesGrossCurrent || 0),
      },
    });
  }

  let weightSales = 0;

  for (const row of openRows) {
    const cl = closingMap.get(row.itemKey);
    const closing = cl?.closingQty || 0;
    const waste = cl?.wasteQty || 0;
    const soldQty = Math.max(0, (row.qty || 0) - closing - waste);

    // price: pricebook active else product active (case-insensitive)
    const keyLc = String(row.itemKey).toLowerCase();
    const pbr = pbLC.get(keyLc);
    const price = pbr
      ? (pbr.active ? Number(pbr.sellPrice || 0) : 0)
      : (() => {
          const prod = prodLC.get(keyLc);
          return prod && prod.active ? Number(prod.sellPrice || 0) : 0;
        })();

    weightSales += soldQty * price;
  }

  const expensesSum = expenses.reduce((a, e) => a + (e.amount || 0), 0);
  const tillSalesGross = tillSalesGrossCurrent; // sum of success payments in current trading period
  const verifiedDeposits = (deposits as any[]).filter((d) => d?.status !== "INVALID").reduce((a: number, d: any) => a + (Number(d?.amount || 0)), 0);

  const todayTotalSales = weightSales - expensesSum;
  const netTill = tillSalesGross - verifiedDeposits;

  // pb/prod maps reused below; outstandingPrev already computed above

  // Inclusive amount to deposit: carryover + today's to-deposit (todayTotalSales - verifiedDeposits)
  // Reduce deposit requirement by gross till takings (cash needed is lower when sales go to till)
  // Allow negative balances (e.g., over-deposited/commission scenarios)
  // Special attendants: do NOT reduce by tillSalesGross (they must deposit their sales)
  const amountToDeposit = isSpecial
    ? Number(outstandingPrev || 0) + Number(todayTotalSales || 0) - Number(verifiedDeposits || 0)
    : Number(outstandingPrev || 0) + Number(todayTotalSales || 0) - Number(verifiedDeposits || 0) - Number(tillSalesGross || 0);

  return NextResponse.json({
    ok: true,
    totals: {
      weightSales,
      expenses: expensesSum,
      todayTotalSales,
      tillSalesGross,
      todayTillSales: tillSalesGross,
      verifiedDeposits,
      netTill,
      openingValue: openingValueGross,
      carryoverPrev: outstandingPrev,
      amountToDeposit,
    },
  });
}
