import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/wa";

function toISODate(d: Date): string { return d.toISOString().slice(0,10); }

export function getCommissionPeriodFor(dateISO: string): { start: string; end: string; key: string } {
  // Period runs from 24th to 23rd of next month.
  const d = new Date(dateISO + "T00:00:00.000Z");
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-11
  const day = d.getUTCDate();

  let start = new Date(Date.UTC(year, month, 24));
  let end = new Date(Date.UTC(year, month + 1, 23));
  if (day < 24) {
    // current date belongs to previous period starting 24th of previous month
    start = new Date(Date.UTC(year, month - 1, 24));
    end = new Date(Date.UTC(year, month, 23));
  }
  const startStr = toISODate(start);
  const endStr = toISODate(end);
  const key = `${startStr}_to_${endStr}`;
  return { start: startStr, end: endStr, key };
}

export async function computeOutletProfit(date: string, outletName: string): Promise<{ salesKsh: number; expensesKsh: number; wasteKsh: number; profitKsh: number }> {
  // Reuse pricebook/product data to value sales and waste
  const [pbRows, products, closings, expenses] = await Promise.all([
    (prisma as any).pricebookRow.findMany({ where: { outletName } }),
    (prisma as any).product.findMany(),
    (prisma as any).attendantClosing.findMany({ where: { date, outletName } }),
    (prisma as any).attendantExpense.findMany({ where: { date, outletName } }),
  ]);
  const pb = new Map<any, any>(pbRows.map((r: any) => [r.productKey, r] as const));
  const prod = new Map<any, any>(products.map((p: any) => [p.key, p] as const));

  // To get sales in value, derive OpeningEff quantities
  // OpeningEff = yesterday closing + today's supply
  const prevDate = (() => { const dt = new Date(date + "T00:00:00.000Z"); dt.setUTCDate(dt.getUTCDate()-1); return toISODate(dt); })();
  const [prevClosing, todaySupply] = await Promise.all([
    (prisma as any).attendantClosing.findMany({ where: { date: prevDate, outletName } }),
    (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName } }),
  ]);
  const openMap = new Map<string, number>();
  for (const r of prevClosing || []) { const k = (r as any).itemKey; const q = Number((r as any).closingQty || 0); openMap.set(k, (openMap.get(k) || 0) + q); }
  for (const r of todaySupply || []) { const k = (r as any).itemKey; const q = Number((r as any).qty || 0); openMap.set(k, (openMap.get(k) || 0) + q); }

  const closingMap = new Map<string, { closing: number; waste: number }>();
  for (const r of closings || []) {
    closingMap.set((r as any).itemKey, { closing: Number((r as any).closingQty || 0), waste: Number((r as any).wasteQty || 0) });
  }

  let salesKsh = 0, wasteKsh = 0;
  for (const [itemKey, openQty] of openMap.entries()) {
    const cl = closingMap.get(itemKey) || { closing: 0, waste: 0 };
    const soldQty = Math.max(0, openQty - cl.closing - cl.waste);
    const price = (() => { const pbr: any = pb.get(itemKey) || null; const pr: any = prod.get(itemKey) || null; return pbr ? (pbr.active ? pbr.sellPrice : 0) : pr?.active ? pr?.sellPrice || 0 : 0; })();
    salesKsh += Math.round(soldQty * price);
    wasteKsh += Math.round((cl.waste || 0) * price);
  }
  const expensesKsh = (expenses || []).reduce((a: number, e: any) => a + (Number(e.amount) || 0), 0);
  const profitKsh = salesKsh - expensesKsh - wasteKsh;
  return { salesKsh, expensesKsh, wasteKsh, profitKsh };
}

export async function upsertAndNotifySupervisorCommission(date: string, outletName: string): Promise<void> {
  // Resolve supervisors for outlet from PhoneMapping
  const supervisors: Array<{ code: string | null; phoneE164: string | null }> = await (prisma as any).phoneMapping.findMany({ where: { role: "supervisor", outlet: outletName }, select: { code: true, phoneE164: true } }).catch(() => []);
  if (!supervisors.length) return; // nothing to notify

  const { salesKsh, expensesKsh, wasteKsh, profitKsh } = await computeOutletProfit(date, outletName);
  const { start: periodStart, end: periodEnd, key: periodKey } = getCommissionPeriodFor(date);
  const rateDefault = 0.10;
  const commissionKsh = Math.max(0, Math.round(profitKsh * rateDefault));

  await Promise.allSettled(supervisors.map(async (s) => {
  const rec = await (prisma as any).supervisorCommission.upsert({
      where: { /* no unique compound; emulate via find+create/update */ id: "" as any },
      // Workaround: manual upsert using findFirst then create/update
    } as any).catch(async () => {
      const existing = await (prisma as any).supervisorCommission.findFirst({ where: { date, outletName, supervisorCode: s.code ?? null } });
      if (existing) {
        return (prisma as any).supervisorCommission.update({ where: { id: existing.id }, data: { salesKsh, expensesKsh, wasteKsh, profitKsh, commissionRate: rateDefault, commissionKsh, supervisorPhone: s.phoneE164 || null, periodKey, status: existing.status || "calculated" } });
      }
      return (prisma as any).supervisorCommission.create({ data: { date, outletName, supervisorCode: s.code ?? null, supervisorPhone: s.phoneE164 || null, salesKsh, expensesKsh, wasteKsh, profitKsh, commissionRate: rateDefault, commissionKsh, periodKey, status: "calculated" } });
    });

    // Compute period-to-date commission "so far" for this supervisor across outlets
    let ptdTotal = 0;
    try {
      if (s.code) {
        const ptdRows = await (prisma as any).supervisorCommission.findMany({ where: { periodKey, supervisorCode: s.code } });
        ptdTotal = (ptdRows || []).reduce((a: number, r: any) => a + (Number(r?.commissionKsh) || 0), 0);
      }
    } catch {}

    // Build WhatsApp message
    const name = s.code || "Supervisor";
    const msg = [
      `Hello ${name},`,
      `Attendant has submitted closing for ${outletName}.`,
      `Total sales: Ksh ${salesKsh.toLocaleString()}.`,
      `Profit after expenses and waste: Ksh ${profitKsh.toLocaleString()}.`,
      `Your commission (10%): Ksh ${commissionKsh.toLocaleString()}.`,
      s.code ? `Commission so far (${periodStart} → ${periodEnd}): Ksh ${ptdTotal.toLocaleString()}.` : undefined,
      `— Baraka Fresh Ops`
    ].filter(Boolean).join("\n");
    try {
      if (s.phoneE164) await sendText(s.phoneE164, msg, "AI_DISPATCH_TEXT");
    } catch {}
  }));
}
