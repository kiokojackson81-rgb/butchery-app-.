import { prisma } from "@/lib/prisma";
import { computeOutletProfit, getCommissionPeriodFor } from "@/server/commission";

/**
 * Recompute (upsert) SupervisorCommission rows for a given date + outlet.
 * Pure recompute: no WhatsApp notifications (notifications handled elsewhere on closing submit).
 * Guarded by env flag SUPERVISOR_COMMISSION_RECOMPUTE=1 when invoked from higher-level orchestration.
 */
export async function recomputeSupervisorCommission(date: string, outletName: string, opts?: { dryRun?: boolean }) {
  const dryRun = !!opts?.dryRun;
  // Identify supervisors mapped to this outlet.
  const supervisors: Array<{ code: string | null; phoneE164: string | null }> = await (prisma as any).phoneMapping.findMany({
    where: { role: "supervisor", outlet: outletName },
    select: { code: true, phoneE164: true },
  }).catch(() => []);
  if (!supervisors.length) return { outlet: outletName, supervisors: 0, upserts: 0 } as const;

  const { salesKsh, expensesKsh, wasteKsh, profitKsh } = await computeOutletProfit(date, outletName);
  const { key: periodKey } = getCommissionPeriodFor(date);
  const rateDefault = 0.10; // Keep in sync with server/commission.ts
  const commissionKsh = Math.max(0, Math.round(profitKsh * rateDefault));

  let upserts = 0;
  if (!dryRun) {
    for (const s of supervisors) {
      // Manual upsert (date, outlet, supervisorCode) triple uniqueness emulation.
      const existing = await (prisma as any).supervisorCommission.findFirst({ where: { date, outletName, supervisorCode: s.code ?? null } });
      if (existing) {
        await (prisma as any).supervisorCommission.update({
          where: { id: existing.id },
          data: { salesKsh, expensesKsh, wasteKsh, profitKsh, commissionRate: rateDefault, commissionKsh, supervisorPhone: s.phoneE164 || null, periodKey, status: existing.status || "calculated" },
        });
      } else {
        await (prisma as any).supervisorCommission.create({
          data: { date, outletName, supervisorCode: s.code ?? null, supervisorPhone: s.phoneE164 || null, salesKsh, expensesKsh, wasteKsh, profitKsh, commissionRate: rateDefault, commissionKsh, periodKey, status: "calculated" },
        });
      }
      upserts++;
    }
  }
  return { outlet: outletName, supervisors: supervisors.length, upserts } as const;
}

export type SupervisorCommissionRecomputeSummary = { outlet: string; supervisors: number; upserts: number };
