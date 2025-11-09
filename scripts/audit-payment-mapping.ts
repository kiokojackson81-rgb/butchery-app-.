#!/usr/bin/env ts-node
/**
 * Audit payment outlet mappings vs current active till configuration.
 *
 * Logic:
 *  - Load active tills (isActive=true). Build a lookup map from each of:
 *      tillNumber, storeNumber, headOfficeNumber -> outletCode.
 *  - Fetch recent payments (default limit 300, order desc by createdAt).
 *  - For each payment derive expectedOutlet using the first non-empty of:
 *      businessShortCode || storeNumber || headOfficeNumber
 *    mapped through the till map. (businessShortCode is what was paid to.)
 *  - Flag mismatches (expectedOutlet && expectedOutlet !== payment.outletCode).
 *  - With --fix, update payment.outletCode to expectedOutlet for each mismatch.
 *
 * Usage:
 *    node scripts/audit-payment-mapping.ts            # show report only
 *    node scripts/audit-payment-mapping.ts --limit 50 # limit rows
 *    node scripts/audit-payment-mapping.ts --fix      # apply corrections
 *
 * Exit codes:
 *   0 success, 1 on unexpected error.
 */
import { prisma } from '@/lib/prisma';

interface TillRow { outletCode: string; tillNumber: string; storeNumber: string; headOfficeNumber: string; isActive: boolean; }
interface PaymentRow { id: string; outletCode: string; businessShortCode: string | null; storeNumber: string | null; headOfficeNumber: string | null; createdAt: string; status: string; amount: number; mpesaReceipt: string | null; }

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: any = { fix: false, limit: 300 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--fix') flags.fix = true;
    else if (a === '--limit') { const v = Number(args[i+1]); if (!isNaN(v)) { flags.limit = v; i++; } }
  }
  return flags;
}

async function loadTillMap() {
  const tills: TillRow[] = await (prisma as any).till.findMany({ where: { isActive: true }, select: { outletCode: true, tillNumber: true, storeNumber: true, headOfficeNumber: true, isActive: true } });
  const map: Record<string, string> = {};
  for (const t of tills) {
    if (t.tillNumber) map[t.tillNumber] = t.outletCode;
    if (t.storeNumber) map[t.storeNumber] = t.outletCode;
    if (t.headOfficeNumber) map[t.headOfficeNumber] = t.outletCode;
  }
  return { map, tills };
}

async function loadPayments(limit: number) {
  const payments: PaymentRow[] = await (prisma as any).payment.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, outletCode: true, businessShortCode: true, storeNumber: true, headOfficeNumber: true, createdAt: true, status: true, amount: true, mpesaReceipt: true,
    },
  });
  return payments;
}

async function main() {
  const { fix, limit } = parseArgs();
  console.log(`[audit-payment-mapping] start fix=${fix} limit=${limit}`);
  const { map, tills } = await loadTillMap();
  const payments = await loadPayments(limit);

  const mismatches: any[] = [];
  for (const p of payments) {
    const code = p.businessShortCode || p.storeNumber || p.headOfficeNumber || '';
    const expectedOutlet = code ? map[code] : undefined;
    if (expectedOutlet && expectedOutlet !== p.outletCode) {
      mismatches.push({ id: p.id, receipt: p.mpesaReceipt, amount: p.amount, paidCode: code, savedOutlet: p.outletCode, expectedOutlet });
    }
  }

  if (fix && mismatches.length) {
    console.log(`[audit-payment-mapping] fixing ${mismatches.length} mismatches...`);
    for (const m of mismatches) {
      try {
        await (prisma as any).payment.update({ where: { id: m.id }, data: { outletCode: m.expectedOutlet } });
      } catch (e: any) {
        console.warn(`Failed to update payment ${m.id}: ${String(e)}`);
      }
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    activeTillCount: tills.length,
    paymentCount: payments.length,
    mismatchCount: mismatches.length,
    mismatches,
  };

  console.log(JSON.stringify(report, null, 2));
  console.log(`Summary: payments=${payments.length} mismatches=${mismatches.length} fixApplied=${fix}`);
}

main().catch(e => { console.error('[audit-payment-mapping] error', e); process.exit(1); });
