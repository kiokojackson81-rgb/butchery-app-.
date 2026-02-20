import React from 'react';
import { prisma } from '@/lib/prisma';
import PaymentsAdmin from './PaymentsAdmin';
import { ToastProvider } from '@/components/ToastProvider';
import { computeExpectedDepositsForOutlets, computeExpectedDepositsForOutletsFromActivePeriod } from '@/lib/reconciliation';
import { addDaysISO, todayLocalISO, APP_TZ } from '@/server/trading_period';

// Ensure this page always runs on Node.js (Prisma needs node:crypto) and never caches
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page({ searchParams }: any) {
  try {
    const outlet = searchParams?.outlet;
    const statusRaw = searchParams?.status;
    const period = searchParams?.period || 'today';
    const sortParam: string = searchParams?.sort || 'createdAt:desc';

    // Build date range for selected period (Nairobi-local trading day by default)
    const buildRange = (p: string): { gte?: Date; lt?: Date } | undefined => {
      if (!p || p === 'all') return undefined;
      const tzOffset = APP_TZ === 'Africa/Nairobi' ? '+03:00' : '+00:00';
      const todayISO = todayLocalISO();
      if (p === 'today') {
        const startISO = todayISO;
        const endISO = addDaysISO(todayISO, 1);
        return { gte: new Date(`${startISO}T00:00:00${tzOffset}`), lt: new Date(`${endISO}T00:00:00${tzOffset}`) };
      }
      if (p === 'yesterday') {
        const startISO = addDaysISO(todayISO, -1);
        const endISO = todayISO;
        return { gte: new Date(`${startISO}T00:00:00${tzOffset}`), lt: new Date(`${endISO}T00:00:00${tzOffset}`) };
      }
      if (p === 'last7') {
        const startISO = addDaysISO(todayISO, -6);
        const endISO = addDaysISO(todayISO, 1);
        return { gte: new Date(`${startISO}T00:00:00${tzOffset}`), lt: new Date(`${endISO}T00:00:00${tzOffset}`) };
      }
      return undefined;
    };

    // Parse sort param like "field:direction"
    const [sortFieldRaw, sortDirRaw] = String(sortParam).split(':');
    const allowedFields = new Set(['createdAt', 'amount', 'status', 'outletCode']);
    const sortField = allowedFields.has(sortFieldRaw) ? sortFieldRaw : 'createdAt';
    const sortDir = sortDirRaw === 'asc' ? 'asc' : 'desc';

    const createdAtRange = buildRange(period);

    const where: any = {};
    if (outlet) where.outletCode = outlet;
    // Normalize and validate status against PaymentStatus enum.
    // Note: we treat legacy 'PAID' as a SUCCESS-equivalent bucket.
    const allowedPaymentStatuses = new Set(['PENDING', 'SUCCESS', 'PAID', 'FAILED', 'REVERSED']);
    const status = String(Array.isArray(statusRaw) ? statusRaw[0] : statusRaw || '').trim().toUpperCase();
    if (status) {
      if (!allowedPaymentStatuses.has(status)) {
        console.warn('[admin/payments] ignoring invalid status filter:', statusRaw);
      } else if (status === 'SUCCESS' || status === 'PAID') {
        where.status = { in: ['SUCCESS', 'PAID'] };
      } else {
        where.status = status;
      }
    }
    if (createdAtRange) where.createdAt = createdAtRange;

    // Primary queries with defensive retry: if Prisma rejects invalid enum values (e.g. legacy 'PAID'),
    // remap or remove the status filter and retry so the page doesn't crash in production.
    let payments: any[] = [];
    let orphans: any[] = [];
    try {
      [payments, orphans] = await Promise.all([
        (prisma as any).payment.findMany({ where, orderBy: { [sortField]: sortDir }, take: 200 }),
        (prisma as any).payment.findMany({ where: { outletCode: 'GENERAL', merchantRequestId: null }, orderBy: { createdAt: 'desc' }, take: 50 }),
      ]);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("not found in enum 'PaymentStatus'") || msg.includes('not found in enum "PaymentStatus"')) {
        console.warn('[admin/payments] Prisma enum error detected; retrying without invalid status filter');
        const retryWhere = { ...where } as any;
        delete retryWhere.status;
        [payments, orphans] = await Promise.all([
          (prisma as any).payment.findMany({ where: retryWhere, orderBy: { [sortField]: sortDir }, take: 200 }),
          (prisma as any).payment.findMany({ where: { outletCode: 'GENERAL', merchantRequestId: null }, orderBy: { createdAt: 'desc' }, take: 50 }),
        ]);
      } else {
        throw e;
      }
    }

    // Totals and expectations
    const outlets = ['BRIGHT','BARAKA_A','BARAKA_B','BARAKA_C','GENERAL'];
    // Align expected deposits to the same window: use ActivePeriod start for current period, else fallback to daily (today) expectation
    const expectedMap = period === 'today'
      ? await computeExpectedDepositsForOutletsFromActivePeriod(outlets, prisma)
      : await computeExpectedDepositsForOutlets(outlets, prisma);
    const outletTotals: any = {};
    // Fetch active period starts for all outlets (used when period === 'today')
    const activePeriods = await (prisma as any).activePeriod.findMany({ where: { outletName: { in: outlets } } }).catch(()=>[] as any[]);
    const apStartMap = new Map<string, Date>();
    for (const ap of (activePeriods as any[])) {
      try {
        if (ap?.outletName && ap?.periodStartAt) apStartMap.set(ap.outletName, new Date(ap.periodStartAt));
      } catch {}
    }
    for (const o of outlets) {
      const sumWhere: any = { outletCode: o, status: { in: ['SUCCESS', 'PAID'] } };
      // For 'today', align to current trading period start per outlet; otherwise fall back to calendar range
      if (period === 'today') {
        const fromTime = apStartMap.get(o);
        if (fromTime) sumWhere.createdAt = { gte: fromTime };
        else if (createdAtRange) sumWhere.createdAt = createdAtRange; // safety fallback
      } else if (createdAtRange) {
        sumWhere.createdAt = createdAtRange;
      }
      const sumRow = await (prisma as any).payment.aggregate({ where: sumWhere, _sum: { amount: true } });
      const sum = Number(sumRow?._sum?.amount || 0);
      // Expose as tillGross for clarity (payments to till within the selected period)
      outletTotals[o] = { tillGross: sum, expected: expectedMap[o] || 0 };
    }

    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Payments</h1>
        <ToastProvider>
          <PaymentsAdmin payments={payments} orphans={orphans} outletTotals={outletTotals} />
        </ToastProvider>
      </div>
    );
  } catch (err: any) {
    console.error('[admin/payments] render failed:', err);
    const message = (err && (err.message || err.toString())) || 'Unknown error';
    const hint = 'Likely causes: database not migrated (Payment/Till tables missing), database unreachable, or serverless timeout.';
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Payments</h1>
        <div className="mt-4 rounded-2xl border p-4 bg-amber-50 text-amber-900">
          <div className="font-medium">Failed to load Payments.</div>
          <div className="text-sm mt-1">{hint}</div>
          <pre className="text-xs mt-3 whitespace-pre-wrap break-words">{message}</pre>
        </div>
      </div>
    );
  }
}
