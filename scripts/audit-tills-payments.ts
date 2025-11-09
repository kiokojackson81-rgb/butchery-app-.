import { prisma } from "@/lib/prisma";
import { todayLocalISO, getPeriodState, countActiveProducts, getCloseCount } from "@/server/trading_period";

// Helper: Nairobi calendar boundaries for today
function startEndOfToday(): { start: Date; end: Date; iso: string } {
  const iso = todayLocalISO();
  // Nairobi has constant +03:00 offset (no DST)
  const start = new Date(`${iso}T00:00:00+03:00`);
  const end = new Date(`${iso}T23:59:59.999+03:00`);
  return { start, end, iso };
}

// Coerce enum-like OutletCode to string names
const OUTLET_NAMES = ["BRIGHT", "BARAKA_A", "BARAKA_B", "BARAKA_C", "GENERAL"] as const;

async function main() {
  const { start, end, iso } = startEndOfToday();

  // 1) Active tills per outlet
  const tills = await (prisma as any).till.findMany({
    where: { isActive: true },
    orderBy: [{ outletCode: "asc" }, { label: "asc" }],
    select: { id: true, label: true, outletCode: true, tillNumber: true, storeNumber: true, headOfficeNumber: true, isActive: true },
  });

  const byOutlet: Record<string, Array<any>> = {};
  for (const t of tills) {
    const key = String(t.outletCode);
    byOutlet[key] = byOutlet[key] || [];
    byOutlet[key].push({
      label: t.label,
      tillNumber: t.tillNumber,
      storeNumber: t.storeNumber,
      headOfficeNumber: t.headOfficeNumber,
      isActive: t.isActive,
    });
  }

  // 2) Today payment aggregates (STK + C2B callbacks)
  const perOutletResults: any[] = [];
  for (const outlet of OUTLET_NAMES) {
    const tillsForOutlet = byOutlet[outlet] || [];

    // Payments (STK Push) table
    const [stkAgg, c2bAgg, tillCountRow, periodState, activeProducts, closeCount] = await Promise.all([
      (prisma as any).payment.aggregate({
        where: {
          outletCode: outlet,
          status: "SUCCESS",
          createdAt: { gte: start, lte: end },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }).catch(() => ({ _count: { _all: 0 }, _sum: { amount: 0 } })),
      // NOTE: Prisma auto-generates camelCase delegate: c2BPayment (matches model name C2BPayment)
      (prisma as any).c2BPayment?.aggregate({
        where: {
          outletCode: outlet,
          receivedAt: { gte: start, lte: end },
        },
        _count: { _all: true },
        _sum: { amount: true },
      })?.catch(() => ({ _count: { _all: 0 }, _sum: { amount: 0 } })),
      (prisma as any).attendantTillCount.findUnique({ where: { date_outletName: { date: iso, outletName: outlet } } }).catch(() => null),
      getPeriodState(outlet, iso).catch(() => "OPEN" as const),
      countActiveProducts(outlet, iso).catch(() => ({ total: 0, closed: 0, active: 0 })),
      getCloseCount(outlet, iso).catch(() => 0),
    ]);

    perOutletResults.push({
      outlet,
      period: periodState,
      closeCount,
      activeProducts,
      tills: tillsForOutlet,
      paymentsToday: {
        stk: { count: Number(stkAgg?._count?._all || 0), amount: Number(stkAgg?._sum?.amount || 0) },
        c2b: { count: Number(c2bAgg?._count?._all || 0), amount: Number(c2bAgg?._sum?.amount || 0) },
      },
      tillCount: tillCountRow ? Number(tillCountRow.counted || 0) : 0,
    });
  }

  const anomalies: string[] = [];
  for (const row of perOutletResults) {
    if ((row.tills || []).length === 0) anomalies.push(`${row.outlet}: No active till records found`);
    for (const t of row.tills) {
      if (!t.tillNumber || !t.storeNumber) anomalies.push(`${row.outlet}: Missing numbers for ${t.label}`);
    }
  }

  const report = { date: iso, outlets: perOutletResults, anomalies };
  // Pretty-print to console for quick inspection
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
