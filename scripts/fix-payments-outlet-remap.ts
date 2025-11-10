#!/usr/bin/env ts-node
/**
 * Bulk remap historical payments to correct outlet after till/store swap (Baraka B vs General).
 *
 * Scenarios:
 *  - Payments persisted with outletCode=GENERAL but whose paid shortcode now maps to BARAKA_B (after swap) should move to BARAKA_B.
 *  - We DO NOT change payments that already match expectedOutlet.
 *  - We DO NOT touch payments where expectedOutlet is undefined (shortcode not found in current active tills).
 *
 * Strategy:
 *  1. Load active tills and build lookup: shortcode (tillNumber|storeNumber|headOfficeNumber) -> outletCode.
 *  2. Fetch payments in a window (default last 30 days) or by explicit --since YYYY-MM-DD.
 *  3. For each payment derive code = businessShortCode || storeNumber || headOfficeNumber.
 *  4. expected = map[code]; if expected && expected !== payment.outletCode, record.
 *  5. If --apply, update outletCode for recorded mismatches.
 *
 * Usage:
 *    node scripts/fix-payments-outlet-remap.ts              # report only (30 days)
 *    node scripts/fix-payments-outlet-remap.ts --since 2025-10-01  # custom start
 *    node scripts/fix-payments-outlet-remap.ts --days 7     # last 7 days
 *    node scripts/fix-payments-outlet-remap.ts --apply      # perform updates
 *
 * Exit: 0 success, 1 on unexpected error.
 */
import { prisma } from '@/lib/prisma';

interface TillRow { outletCode: string; tillNumber: string; storeNumber: string; headOfficeNumber: string; }
interface PaymentRow { id: string; outletCode: string; businessShortCode: string; storeNumber: string; headOfficeNumber: string; createdAt: Date; amount: number; mpesaReceipt: string | null; }

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: any = { apply: false, since: null as null | Date, days: 30 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--apply') flags.apply = true;
    else if (a === '--since') { const v = args[i+1]; if (v) { flags.since = new Date(v + 'T00:00:00Z'); i++; } }
    else if (a === '--days') { const v = Number(args[i+1]); if (!isNaN(v)) { flags.days = v; i++; } }
  }
  if (!flags.since) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - flags.days);
    d.setUTCHours(0,0,0,0);
    flags.since = d;
  }
  return flags;
}

async function loadTillMap() {
  const tills: TillRow[] = await (prisma as any).till.findMany({ where: { isActive: true }, select: { outletCode: true, tillNumber: true, storeNumber: true, headOfficeNumber: true } });
  const map: Record<string, string> = {};
  for (const t of tills) {
    if (t.tillNumber) map[t.tillNumber] = t.outletCode;
    if (t.storeNumber) map[t.storeNumber] = t.outletCode;
    if (t.headOfficeNumber) map[t.headOfficeNumber] = t.outletCode;
  }
  return map;
}

async function loadPayments(since: Date) {
  // Use raw query with COALESCE to avoid Prisma runtime mismatch when DB has nulls in non-null columns
  const rows = await (prisma as any).$queryRawUnsafe(
    `SELECT id,
            "outletCode" as "outletCode",
            COALESCE("businessShortCode", '') as "businessShortCode",
            COALESCE("storeNumber", '') as "storeNumber",
            COALESCE("headOfficeNumber", '') as "headOfficeNumber",
            "createdAt" as "createdAt",
            COALESCE("amount", 0) as "amount",
            "mpesaReceipt" as "mpesaReceipt"
       FROM "Payment"
      WHERE "createdAt" >= $1
      ORDER BY "createdAt" DESC`,
    since
  ) as PaymentRow[];
  return rows;
}

async function main() {
  const { apply, since } = parseArgs();
  console.log(`[fix-payments-outlet-remap] start apply=${apply} since=${since?.toISOString()}`);
  const tillMap = await loadTillMap();
  const payments = await loadPayments(since!);

  const mismatches: Array<{ id: string; receipt: string | null; oldOutlet: string; expectedOutlet: string; paidCode: string; createdAt: string; amount: number }> = [];
  for (const p of payments) {
    const code = p.businessShortCode || p.storeNumber || p.headOfficeNumber || '';
    const expected = code ? tillMap[code] : undefined;
    if (expected && expected !== p.outletCode) {
      mismatches.push({ id: p.id, receipt: p.mpesaReceipt, oldOutlet: p.outletCode, expectedOutlet: expected, paidCode: code, createdAt: p.createdAt.toISOString(), amount: p.amount });
    }
  }

  if (apply && mismatches.length) {
    console.log(`[fix-payments-outlet-remap] applying ${mismatches.length} updates...`);
    for (const m of mismatches) {
      try {
        await (prisma as any).payment.update({ where: { id: m.id }, data: { outletCode: m.expectedOutlet } });
      } catch (e: any) {
        console.warn(`Failed to update payment ${m.id}: ${String(e)}`);
      }
    }
  }

  const report = { timestamp: new Date().toISOString(), since: since?.toISOString(), scanned: payments.length, mismatches: mismatches.length, items: mismatches };
  console.log(JSON.stringify(report, null, 2));
  console.log(`Summary: scanned=${payments.length} mismatches=${mismatches.length} apply=${apply}`);
}

main().catch(e => { console.error('[fix-payments-outlet-remap] error', e); process.exit(1); });
