import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/supervisor/overview?date=YYYY-MM-DD&outlet=OutletName
// Returns combined summary data to reduce multiple client round trips.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get('date') || '').trim();
    const outlet = (searchParams.get('outlet') || '').trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: 'Missing date/outlet' }, { status: 400 });

    // Parallel fetches (keep existing table sources)
    const [summaryRes, depositsRes, expensesRes, closingRes, supplyRes] = await Promise.all([
      (prisma as any).supervisorSummary.findFirst({ where: { date, outletName: outlet } }).catch(()=>null),
      (prisma as any).attendantDeposit.findMany({ where: { date, outletName: outlet } }).catch(()=>[]),
      (prisma as any).attendantExpense.findMany({ where: { date, outletName: outlet } }).catch(()=>[]),
      (prisma as any).attendantClosing.findMany({ where: { date, outletName: outlet } }).catch(()=>[]),
      (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet } }).catch(()=>[]),
    ]);

    const deposits = (depositsRes || []).map((d:any)=>({ id:d.id, amount:Number(d.amount||0), status:d.status||'PENDING', code:d.code||null, createdAt:d.createdAt }));
    const expenses = (expensesRes || []).map((e:any)=>({ id:e.id, amount:Number(e.amount||0), note:e.note||null }));
    const closings = (closingRes || []).map((c:any)=>({ id:c.id, itemKey:c.itemKey, closingQty:Number(c.closingQty||0), wasteQty:Number(c.wasteQty||0) }));
    const supply = (supplyRes || []).map((s:any)=>({ id:s.id, itemKey:s.itemKey, qty:Number(s.qty||0) }));

    const summary = summaryRes ? {
      expectedSales: Number(summaryRes.expectedSales||0),
      expenses: Number(summaryRes.expenses||0),
      deposits: Number(summaryRes.deposits||0),
      cashAtTill: Number(summaryRes.cashAtTill||0),
      variance: Number(summaryRes.variance||0),
    } : null;

    return NextResponse.json({ ok: true, date, outlet, summary, deposits, expenses, closings, supply });
  } catch (e:any) {
    console.warn('overview.fail', e?.message || e);
    return NextResponse.json({ ok:false, error:'Server error' }, { status:500 });
  }
}