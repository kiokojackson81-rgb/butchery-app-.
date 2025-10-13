// src/lib/analytics/supply-insights.service.ts
import { prisma } from "@/lib/prisma";

type DayKey = string; // YYYY-MM-DD

export async function buildDailyProductSupplyStats(date: DayKey, outletName: string) {
  // Load openings, closings for the day, and yesterday closing for opening-effective
  const [openings, closings, pricebook] = await Promise.all([
    (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName } }),
    (prisma as any).attendantClosing.findMany({ where: { date, outletName } }),
    (prisma as any).pricebookRow.findMany({ where: { outletName } }),
  ]);
  const pb = new Map<string, any>((pricebook || []).map((r: any) => [r.productKey, r]));
  const cMap = new Map<string, any>((closings || []).map((r: any) => [r.itemKey, r]));

  const openMap = new Map<string, number>();
  for (const r of openings || []) {
    const k = String((r as any).itemKey);
    const q = Number((r as any).qty || 0);
    openMap.set(k, (openMap.get(k) || 0) + q);
  }

  const allKeys = new Set<string>([...openMap.keys(), ...cMap.keys()]);
  for (const productKey of allKeys) {
    const openingQty = Number(openMap.get(productKey) || 0);
    const closeRow: any = cMap.get(productKey) || {};
    const closingQty = Number(closeRow?.closingQty || 0);
    const wasteQty = Number(closeRow?.wasteQty || 0);
    const supplyQty = openingQty; // today supply rows are openingQty for the day
    const salesQty = Math.max(0, openingQty - closingQty - wasteQty);

    // Simple moving averages placeholder: reuse last 7/14 stats if available
    const last14 = await (prisma as any).productSupplyStat.findMany({
      where: { outletName, productKey },
      orderBy: { date: "desc" },
      take: 14,
    });
    const ma7_salesQty = avg((last14 || []).slice(0, 7).map((x: any) => Number(x.salesQty || 0)));
    const ma14_salesQty = avg((last14 || []).map((x: any) => Number(x.salesQty || 0)));

    let leadTimeDays = (last14?.[0]?.leadTimeDays as number | undefined) ?? 1;
    if (!Number.isFinite(leadTimeDays) || leadTimeDays! < 1) leadTimeDays = 1;
    const avgDemand = ma7_salesQty || ma14_salesQty || salesQty; // fallback
    const safetyStock = avgDemand * 0.5; // placeholder SS
    const reorderPoint = avgDemand * leadTimeDays + (safetyStock || 0);
    const parLevel = avgDemand * 2; // 2 days cover default

    await (prisma as any).productSupplyStat.upsert({
      where: { date_outletName_productKey: { date, outletName, productKey } },
      update: { salesQty, wasteQty, openingQty, supplyQty, closingQty, ma7_salesQty, ma14_salesQty, leadTimeDays, safetyStock, reorderPoint, parLevel },
      create: { date, outletName, productKey, salesQty, wasteQty, openingQty, supplyQty, closingQty, ma7_salesQty, ma14_salesQty, leadTimeDays, safetyStock, reorderPoint, parLevel },
    });
  }

  return { ok: true } as const;
}

function avg(arr: number[]): number { if (!arr.length) return 0; const s = arr.reduce((a, n) => a + (Number(n) || 0), 0); return s / arr.length; }

export function recommendSupplyAction(stat: any) {
  const closingQty = Number(stat?.closingQty || 0);
  const reorderPoint = Number(stat?.reorderPoint || 0);
  const parLevel = Number(stat?.parLevel || 0);
  const avgDaily = Number(stat?.ma7_salesQty || stat?.ma14_salesQty || 0);

  let action = "MAINTAIN";
  let reason = "Stable";
  let suggestedQty = 0;
  let confidence = 0.4;
  if (closingQty < reorderPoint) {
    action = "INCREASE_SUPPLY";
    reason = "Below reorder point";
    suggestedQty = Math.max(0, reorderPoint + avgDaily - closingQty);
    confidence = 0.8;
  } else if (parLevel > 0 && closingQty > parLevel * 1.3) {
    action = "REDUCE_SUPPLY";
    reason = "Above par x1.3";
    suggestedQty = 0;
    confidence = 0.7;
  }
  return { action, reason, suggestedQty, confidence } as const;
}

export async function computeSupplyRecommendations(date: DayKey, outletName: string) {
  const stats = await (prisma as any).productSupplyStat.findMany({ where: { date, outletName } });
  const recs = [] as any[];
  for (const s of stats) {
    const r = recommendSupplyAction(s);
    recs.push({ date, outletName, productKey: (s as any).productKey, ...r });
  }
  for (const r of recs) {
    await (prisma as any).supplyRecommendation.upsert({
      where: { date_outletName_productKey: { date, outletName, productKey: r.productKey } },
      update: { action: r.action, reason: r.reason, suggestedQty: r.suggestedQty, confidence: r.confidence },
      create: { date, outletName, productKey: r.productKey, action: r.action, reason: r.reason, suggestedQty: r.suggestedQty, confidence: r.confidence },
    });
  }
  return recs;
}
