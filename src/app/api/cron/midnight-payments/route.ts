import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeDayTotals } from '@/server/finance';
import { sendMidnightSummary } from '@/lib/wa_notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const date = new Date().toISOString().slice(0,10);
    const adminPhones = (process.env.ADMIN_PHONES || '').split(',').map(s=>s.trim()).filter(Boolean);
    const barakaASupervisor = process.env.SUPERVISOR_BARAKA_A || null;
    const kyaloPhone = process.env.KYALO_PHONE || null;

    const outlets = await (prisma as any).outlet.findMany().catch(()=>[]);
    let totalCount = 0; let totalAmt = 0; let topPayersArr: string[] = [];
    for (const o of outlets) {
      const stats = await computeDayTotals({ date, outletName: o.name });
      const paymentsCount = stats ? (Array.isArray((stats as any).payments) ? (stats as any).payments.length : (stats.tillSalesGross ? 1 : 0)) : 0;
      totalCount += paymentsCount;
      totalAmt += Math.round(stats.tillSalesGross || 0);
      topPayersArr.push(`${o.name}:${Math.round(stats.tillSalesGross||0)}`);
      if (o.name === 'Baraka A') {
        if (barakaASupervisor) await sendMidnightSummary({ to: barakaASupervisor, outlet: 'Baraka A', date, count: paymentsCount, total: Math.round(stats.tillSalesGross||0), topPayers: '' });
        if (kyaloPhone) await sendMidnightSummary({ to: kyaloPhone, outlet: 'Baraka A', date, count: paymentsCount, total: Math.round(stats.tillSalesGross||0), topPayers: '' });
      }
    }
    const topPayers = topPayersArr.slice(0,5).join(', ');
    for (const admin of adminPhones) {
      await sendMidnightSummary({ to: admin, outlet: 'All outlets', date, count: totalCount, total: totalAmt, topPayers });
    }
    return NextResponse.json({ ok: true });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
