import { prisma } from '@/lib/prisma';

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
