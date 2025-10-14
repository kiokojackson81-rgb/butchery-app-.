// src/lib/analytics/day-close.service.ts
import { prisma } from "@/lib/prisma";
import { computeOutletPerformance, computeAllOutletsPerformance } from "./performance.service";
import { computeAllAttendantKPIs } from "./attendant-kpi.service";
import { buildDailyProductSupplyStats, computeSupplyRecommendations } from "./supply-insights.service";
import { nightlyRecalcOpenIntervals, closeOpenSupplyIntervalsIfNeeded } from "./intervals.service";
import { sendTextSafe, getPhoneByCode } from "@/lib/wa";

type DayKey = string; // YYYY-MM-DD

// Pure helper to build attendant end-of-day message about weight/commission
export function buildAttendantCommissionMessage(opts: { totalWeight: number; target: number; rate: number; amount: number; name?: string }) {
  const totalWeight = Number(opts.totalWeight || 0);
  const target = Number(opts.target || 0);
  const rate = Number(opts.rate || 0);
  const amount = Number(opts.amount || 0);
  const name = opts.name || "Attendant";
  const diff = Math.max(0, target - totalWeight);
  return amount > 0
    ? `You sold ${totalWeight.toFixed(1)} kg today (target ${target.toFixed(0)} kg). You earned a commission of Ksh ${Math.round(amount)}. Great job, ${name}!`
    : (target > 0
      ? `You sold ${totalWeight.toFixed(1)} kg today (target ${target.toFixed(0)} kg). You were short by ${diff.toFixed(1)} kg. Potential commission at Ksh ${rate}/kg next time. Keep pushing, ${name}!`
      : `You sold ${totalWeight.toFixed(1)} kg today.`);
}

export async function submitDay(outletName: string, businessDate: Date) {
  const date = businessDate.toISOString().slice(0, 10);
  await (prisma as any).dayClosePeriod.upsert({
    where: { outletName_businessDate: { outletName, businessDate: date } },
    update: { status: "SUBMITTED", submittedAt: new Date() },
    create: { outletName, businessDate: date, status: "SUBMITTED", submittedAt: new Date() },
  });
  return { ok: true } as const;
}

export async function lockDay(outletName: string, businessDate: Date, lockedBy: string) {
  const date: DayKey = businessDate.toISOString().slice(0, 10);
  await (prisma as any).dayClosePeriod.upsert({
    where: { outletName_businessDate: { outletName, businessDate: date } },
    update: { status: "LOCKED", lockedAt: new Date(), lockedBy },
    create: { outletName, businessDate: date, status: "LOCKED", lockedAt: new Date(), lockedBy },
  });

  // Compute metrics (idempotent)
  // First compute outlet totals, then attendants (with commission), then recompute outlet to include commission aggregation
  await computeOutletPerformance(date, outletName);
  await computeAllAttendantKPIs(date, outletName);
  await computeOutletPerformance(date, outletName);
  await buildDailyProductSupplyStats(date, outletName);
  await computeSupplyRecommendations(date, outletName);
  await nightlyRecalcOpenIntervals(date);
  await closeOpenSupplyIntervalsIfNeeded(date);
  // Notify attendants with end-of-day commission summary (no sensitive data)
  try {
    const kpis = await (prisma as any).attendantKPI.findMany({ where: { date, outletName } });
    for (const k of kpis || []) {
      try {
        const attId = (k as any).attendantId as string;
        const att = await (prisma as any).attendant.findUnique({ where: { id: attId } }).catch(() => null);
        const code = att?.loginCode || null;
        let phone: string | null = null;
        if (code) {
          const m = await (prisma as any).phoneMapping.findUnique({ where: { code } }).catch(() => null);
          phone = m?.phoneE164 || null;
        }
        if (!phone) continue;
        const msg = buildAttendantCommissionMessage({
          totalWeight: Number((k as any).totalWeight || 0),
          target: Number((k as any).commissionTarget || 0),
          rate: Number((k as any).commissionRate || 0),
          amount: Number((k as any).commissionAmount || 0),
          name: att?.name || undefined,
        });
        await sendTextSafe(phone, msg, "AI_DISPATCH_TEXT", { gpt_sent: true });
      } catch {}
    }
  } catch {}
  // Supervisor/Admin digest for this outlet/day (includes commissions and top performers)
  try {
    const whereOutlet: any = { outletName };
    // Compute summary similar to supervisor flow
    const [closings, expenses, deposits] = await Promise.all([
      (prisma as any).attendantClosing.count({ where: { date, ...whereOutlet } }),
      (prisma as any).attendantExpense.findMany({ where: { date, ...whereOutlet } }),
      (prisma as any).attendantDeposit.findMany({ where: { date, status: "VALID", ...whereOutlet } }),
    ]);
    const expenseSum = (expenses || []).reduce((s: number, e: any) => s + (e.amount || 0), 0);
    const depositSum = (deposits || []).reduce((s: number, d: any) => s + (d.amount || 0), 0);
    let totalCommission = 0;
    try {
      const perf = await (prisma as any).outletPerformance.findUnique({ where: { date_outletName: { date, outletName } } });
      totalCommission = Number(perf?.totalCommission || 0);
    } catch {}
    if (!totalCommission) {
      try {
        const kpis = await (prisma as any).attendantKPI.findMany({ where: { date, ...whereOutlet } });
        totalCommission = (kpis || []).reduce((s: number, k: any) => s + Number(k?.commissionAmount || 0), 0);
      } catch {}
    }
    const topKPIs = await (prisma as any).attendantKPI.findMany({
      where: { date, ...whereOutlet },
      include: { attendant: true },
      take: 5,
    }).catch(() => [] as any[]);
    let topCommissionLine = "Top commission: -";
    let topWeightLine = "Top weight: -";
    if (topKPIs && topKPIs.length) {
      const byCommission = [...topKPIs].sort((a: any, b: any) => Number(b.commissionAmount || 0) - Number(a.commissionAmount || 0))[0];
      const byWeight = [...topKPIs].sort((a: any, b: any) => Number(b.totalWeight || 0) - Number(a.totalWeight || 0))[0];
      if (byCommission) {
        const name = (byCommission.attendant as any)?.name || "Attendant";
        const amt = Math.round(Number(byCommission.commissionAmount || 0));
        topCommissionLine = `Top commission: ${name} — KSh ${amt}`;
      }
      if (byWeight) {
        const name = (byWeight.attendant as any)?.name || "Attendant";
        const kg = Number(byWeight.totalWeight || 0);
        topWeightLine = `Top weight: ${name} — ${kg.toFixed(1)} kg`;
      }
    }
    const head = `${outletName} • ${date}`;
    const commissionLine = `Commission: KSh ${Math.round(totalCommission)}`;
    const text = [
      head,
      `Closings: ${closings}`,
      `Expenses: KSh ${expenseSum}`,
      `Deposits: KSh ${depositSum}`,
      commissionLine,
      topWeightLine,
      topCommissionLine,
    ].join("\n");
    // Send to supervisors/admins for this outlet
    const rows = await (prisma as any).phoneMapping.findMany({ where: { role: { in: ["supervisor", "admin"] as any }, outlet: outletName } });
    for (const r of rows || []) {
      const phone = r?.phoneE164; if (!phone) continue;
      await sendTextSafe(phone, text, "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
  } catch {}
  return { ok: true } as const;
}
