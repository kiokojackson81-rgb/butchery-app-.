import React from 'react';
import { prisma } from '@/lib/prisma';
import PaymentsAdmin from './PaymentsAdmin';
import { ToastProvider } from '@/components/ToastProvider';
import { computeExpectedDepositsForOutlets } from '@/lib/reconciliation';

// Ensure this page always runs on Node.js (Prisma needs node:crypto) and never caches
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page({ searchParams }: any) {
  try {
    const outlet = searchParams?.outlet;
    const status = searchParams?.status;
    const where: any = {};
    if (outlet) where.outletCode = outlet;
    if (status) where.status = status;

    // Primary queries
    const [payments, orphans] = await Promise.all([
      (prisma as any).payment.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 }),
      (prisma as any).payment.findMany({ where: { outletCode: 'GENERAL', merchantRequestId: null }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);

    // Totals and expectations
    const outlets = ['BRIGHT','BARAKA_A','BARAKA_B','BARAKA_C','GENERAL'];
    const expectedMap = await computeExpectedDepositsForOutlets(outlets, prisma);
    const outletTotals: any = {};
    for (const o of outlets) {
      const sumRow = await (prisma as any).payment.aggregate({ where: { outletCode: o, status: 'SUCCESS' }, _sum: { amount: true } });
      const sum = Number(sumRow?._sum?.amount || 0);
      outletTotals[o] = { deposits: sum, expected: expectedMap[o] || 0 };
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
