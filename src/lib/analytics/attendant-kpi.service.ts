// src/lib/analytics/attendant-kpi.service.ts
import { prisma } from "@/lib/prisma";

type DayKey = string; // YYYY-MM-DD

export async function getShiftsForDate(outletName: string, date: DayKey) {
  return (prisma as any).shift.findMany({ where: { outletName, date } });
}

export async function computeAttendantKPI(date: DayKey, outletName: string, attendantId: string) {
  // Gather basic info
  // Attendant may lack salaryAmount column in drifted prod DB; tolerate gracefully.
  const attendantPromise: Promise<any> = (async () => {
    try {
      return await (prisma as any).attendant.findUnique({ where: { id: attendantId } });
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (msg.includes('salaryAmount')) {
        // Fallback raw select without salary columns; synthesize defaults
        try {
          const rows: any[] = await (prisma as any).$queryRawUnsafe(`SELECT id, name, loginCode, "outletId" as outletId, "createdAt" as createdAt, "updatedAt" as updatedAt FROM "Attendant" WHERE id = '${attendantId.replace(/'/g, "''")}' LIMIT 1`);
          const r = rows[0];
          if (r) return { ...r, salaryAmount: 0, salaryFrequency: 'daily' };
        } catch {}
      }
      return null;
    }
  })();
  const assignmentsPromise = (prisma as any).productAssignment.findMany({ where: { attendantId, outletName } });
  const [attendant, assignments] = await Promise.all([attendantPromise, assignmentsPromise]);

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
  let depositExpected = Number(perf?.expectedDeposit || 0) * factor;
  const depositActual = Number(perf?.deposits || 0) * factor;
  // Commission: compute total weight over assigned products and config
  const productKeys: string[] = (assignments || []).map((a: any) => String(a.productKey)).filter(Boolean);
  // Load per-product daily salesQty from ProductSupplyStat
  let totalWeight = 0;
  if (productKeys.length) {
    const stats = await (prisma as any).productSupplyStat.findMany({ where: { date, outletName, productKey: { in: productKeys } } });
    // Weight attribution: split by shareRule if multiple attendants share a product
    const shareByKey = new Map<string, number>();
    for (const a of assignments || []) {
      const pk = String((a as any).productKey);
      const s = Number((a as any).shareRule ?? 1) || 1;
      shareByKey.set(pk, (shareByKey.get(pk) || 0) + s);
    }
    for (const s of stats || []) {
      const pk = String((s as any).productKey);
      const salesQty = Number((s as any).salesQty || 0); // already in kg units per domain
      const myShare = Number(((assignments || []).find((a: any) => String(a.productKey) === pk)?.shareRule) ?? 1) || 1;
      const denom = Number(shareByKey.get(pk) || myShare) || 1;
      totalWeight += salesQty * (myShare / denom);
    }
  }
  // Commission config defaults
  const cfg = await (prisma as any).commissionConfig.findUnique({ where: { attendantId } }).catch(() => null);
  const commissionTarget = Number(cfg?.targetKg ?? 25);
  const commissionRate = Number(cfg?.ratePerKg ?? 50);
  const commissionKg = Math.max(0, totalWeight - commissionTarget);
  const commissionAmount = Math.max(0, commissionKg * commissionRate);
  // Adjust required deposit by commission (attendant keeps commission cash)
  depositExpected = Math.max(0, depositExpected - commissionAmount);
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
    update: { sales, gp, expenses, np, salaryDay, roiVsSalary, wasteCost, wastePct, depositExpected, depositActual, depositGap, redFlags, totalWeight, commissionTarget, commissionRate, commissionKg, commissionAmount },
    create: { date, attendantId, outletName, sales, gp, expenses, np, salaryDay, roiVsSalary, wasteCost, wastePct, depositExpected, depositActual, depositGap, redFlags, totalWeight, commissionTarget, commissionRate, commissionKg, commissionAmount },
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
