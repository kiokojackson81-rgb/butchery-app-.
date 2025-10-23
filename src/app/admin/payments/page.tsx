import React from 'react';
import { prisma } from '@/lib/prisma';
import PaymentsAdmin from './PaymentsAdmin';
import { ToastProvider } from '@/components/ToastProvider';
import { computeExpectedDepositsForOutlets } from '@/lib/reconciliation';

export default async function Page({ searchParams }: any) {
  const outlet = searchParams?.outlet;
  const status = searchParams?.status;
  const where: any = {};
  if (outlet) where.outletCode = outlet;
  if (status) where.status = status;
  const payments = await (prisma as any).payment.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  const orphans = await (prisma as any).payment.findMany({ where: { outletCode: 'GENERAL', merchantRequestId: null }, orderBy: { createdAt: 'desc' }, take: 50 });

  const outlets = ['BRIGHT','BARAKA_A','BARAKA_B','BARAKA_C','GENERAL'];
  const expectedMap = await computeExpectedDepositsForOutlets(outlets, prisma);
  const outletTotals: any = {};
  for (const o of outlets) {
    const sum = Number((await (prisma as any).payment.aggregate({ where: { outletCode: o, status: 'SUCCESS' }, _sum: { amount: true } }))._sum.amount || 0);
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
}
