// src/lib/analytics/attendant-kpi.service.ts
import { prisma } from "@/lib/prisma";

type DayKey = string; // YYYY-MM-DD

export async function getShiftsForDate(outletName: string, date: DayKey) {
  return (prisma as any).shift.findMany({ where: { outletName, date } });
}

export async function computeAttendantKPI(date: DayKey, outletName: string, attendantId: string) {
  // Gather basic info
  const [attendant, assignments] = await Promise.all([
    (prisma as any).attendant.findUnique({ where: { id: attendantId } }),
    (prisma as any).productAssignment.findMany({ where: { attendantId, outletName } }),
  ]);

  // Reuse outlet performance then split by share rules as a first iteration
  const perf = await (prisma as any).outletPerformance.findUnique({ where: { date_outletName: { date, outletName } } });
  const share = (assignments || []).reduce((a: number, x: any) => a + (Number(x.shareRule ?? 1) || 0), 0) || 1;
  const factor = Math.min(1, Math.max(0, share / Math.max(share, 1)));

  const sales = Number(perf?.totalSales || 0) * factor;
  const gp = Number(perf?.grossProfit || 0) * factor;
  const expenses = Number(perf?.expenses || 0) * factor;
  const np = gp - expenses;
  // Pro-rate salary based on frequency
  const a: any = attendant || {};
  const amt = Number(a.salaryAmount || 0);
  const freq = String(a.salaryFrequency || 'daily');
  const salaryDay = freq === 'weekly' ? (amt / 7) : freq === 'monthly' ? (amt / 30) : amt;
  const roiVsSalary = salaryDay > 0 ? np / salaryDay : 0;
  const depositExpected = Number(perf?.expectedDeposit || 0) * factor;
  const depositActual = Number(perf?.deposits || 0) * factor;
  const depositGap = Math.max(0, depositExpected - depositActual);
  const wasteCost = Number(perf?.wasteCost || 0) * factor;
  const wastePct = Number(perf?.wastePct || 0);

  // Basic red flags
  const redFlags: string[] = [];
  if (roiVsSalary < 1 && salaryDay > 0) redFlags.push("LOW_ROI_SALARY");
  if (depositGap > 0.1 * (depositExpected || 1)) redFlags.push("LOW_DEPOSIT");
  if (wastePct > 0.08) redFlags.push("HIGH_PRODUCT_WASTE");

  await (prisma as any).attendantKPI.upsert({
    where: { date_attendantId_outletName: { date, attendantId, outletName } },
    update: { sales, gp, expenses, np, salaryDay, roiVsSalary, wasteCost, wastePct, depositExpected, depositActual, depositGap, redFlags },
    create: { date, attendantId, outletName, sales, gp, expenses, np, salaryDay, roiVsSalary, wasteCost, wastePct, depositExpected, depositActual, depositGap, redFlags },
  });

  return { ok: true } as const;
}

export async function computeAllAttendantKPIs(date: DayKey, outletName: string) {
  const shifts = await getShiftsForDate(outletName, date);
  for (const s of shifts) {
    await computeAttendantKPI(date, outletName, (s as any).attendantId);
  }
  return { ok: true } as const;
}
