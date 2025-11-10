import { prisma } from '@/lib/prisma';
import { APP_TZ, dateISOInTZ } from '@/server/trading_period';

// Compute expected deposits for an outlet by summing today's attendant closings
// multiplied by pricebook sell prices. Falls back to 0 when data missing.
export async function computeExpectedDepositsForOutlet(outletCode: string, dbClient?: any) {
  const client = dbClient || prisma;
  const outletName = outletCode; // convention: outletCode matches outletName
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Get closing rows for today for this outlet
  const closings = await (client as any).attendantClosing.findMany({ where: { date: today, outletName } });
  if (!closings || closings.length === 0) return 0;

  // For each closing row, find the matching pricebook row and sum closingQty * sellPrice
  let total = 0;
  for (const c of closings) {
    const priceRow = await (client as any).pricebookRow.findUnique({ where: { outletName_productKey: { outletName, productKey: c.itemKey } } }).catch(() => null);
    const price = priceRow ? Number(priceRow.sellPrice || 0) : 0;
    total += Number(c.closingQty || 0) * price;
  }
  return Math.round(total);
}

export async function computeExpectedDepositsForOutlets(outletCodes: string[], dbClient?: any) {
  const result: Record<string, number> = {};
  for (const o of outletCodes) {
    result[o] = await computeExpectedDepositsForOutlet(o, dbClient);
  }
  return result;
}

// ActivePeriod-aware: sum expected deposits (closingQty * sellPrice) since the current
// trading period start per outlet. Uses ActivePeriod.periodStartAt → local YYYY-MM-DD.
// Falls back to the current local date when ActivePeriod is missing.
export async function computeExpectedDepositsForOutletsFromActivePeriod(outletCodes: string[], dbClient?: any) {
  const client = dbClient || prisma;
  const tz = APP_TZ;
  const apRows = await (client as any).activePeriod.findMany({ where: { outletName: { in: outletCodes } } }).catch(()=>[]);
  const apMap = new Map<string, string>(); // outletName -> fromDate (YYYY-MM-DD in tz)
  for (const ap of (apRows || []) as any[]) {
    try {
      if (ap?.outletName && ap?.periodStartAt) {
        apMap.set(ap.outletName, dateISOInTZ(new Date(ap.periodStartAt), tz));
      }
    } catch {}
  }

  // default from date is today in tz to avoid overcounting when AP missing
  const today = dateISOInTZ(new Date(), tz);
  const result: Record<string, number> = {};

  for (const outletName of outletCodes) {
    const fromDate = apMap.get(outletName) || today;
    // Fetch all closing rows from fromDate (inclusive)
    const closings = await (client as any).attendantClosing.findMany({ where: { outletName, date: { gte: fromDate } } });
    if (!closings || closings.length === 0) { result[outletName] = 0; continue; }
    let total = 0;
    for (const c of closings) {
      const priceRow = await (client as any).pricebookRow.findUnique({ where: { outletName_productKey: { outletName, productKey: c.itemKey } } }).catch(() => null);
      const price = priceRow ? Number(priceRow.sellPrice || 0) : 0;
      total += Number(c.closingQty || 0) * price;
    }
    result[outletName] = Math.round(total);
  }

  return result;
}
