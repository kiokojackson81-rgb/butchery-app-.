import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeDayTotals, computeSnapshotTotals } from '@/server/finance';
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
    const [summaryRes, depositsRes, expensesRes, closingRes, supplyRes, snap1, snap2] = await Promise.all([
      (prisma as any).supervisorSummary.findFirst({ where: { date, outletName: outlet } }).catch(()=>null),
      (prisma as any).attendantDeposit.findMany({ where: { date, outletName: outlet } }).catch(()=>[]),
      (prisma as any).attendantExpense.findMany({ where: { date, outletName: outlet } }).catch(()=>[]),
      (prisma as any).attendantClosing.findMany({ where: { date, outletName: outlet } }).catch(()=>[]),
      (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet } }).catch(()=>[]),
      // Snapshots written by /api/period/start on first/second close
      (prisma as any).setting.findUnique({ where: { key: `snapshot:closing:${date}:${outlet}:1` } }).catch(()=>null),
      (prisma as any).setting.findUnique({ where: { key: `snapshot:closing:${date}:${outlet}:2` } }).catch(()=>null),
    ]);

    const deposits = (depositsRes || []).map((d:any)=>({ id:d.id, amount:Number(d.amount||0), status:d.status||'PENDING', code:d.code||null, createdAt:d.createdAt }));
    const expenses = (expensesRes || []).map((e:any)=>({ id:e.id, amount:Number(e.amount||0), note:e.note||null }));
    const closings = (closingRes || []).map((c:any)=>({ id:c.id, itemKey:c.itemKey, closingQty:Number(c.closingQty||0), wasteQty:Number(c.wasteQty||0) }));
    const supply = (supplyRes || []).map((s:any)=>({ id:s.id, itemKey:s.itemKey, qty:Number(s.qty||0) }));

    let summary: { expectedSales: number; expenses: number; deposits: number; cashAtTill: number; variance: number } | null = null;
    if (summaryRes) {
      summary = {
        expectedSales: Number(summaryRes.expectedSales||0),
        expenses: Number(summaryRes.expenses||0),
        deposits: Number(summaryRes.deposits||0),
        cashAtTill: Number(summaryRes.cashAtTill||0),
        variance: Number(summaryRes.variance||0),
      };
    } else {
      // Fallback: compute totals live, with snapshot support if closings were cleared by rotation
      try {
        const hasLiveClosings = Array.isArray(closingRes) && closingRes.length > 0;
        let totals: any = await computeDayTotals({ date, outletName: outlet });
        if (!hasLiveClosings) {
          const snap = (snap2 as any)?.value || (snap1 as any)?.value || null;
          if (snap && typeof snap === 'object') {
            const openingSnapshot = (snap as any).openingSnapshot || {};
            const clos = Array.isArray((snap as any).closings) ? (snap as any).closings : [];
            const exps = Array.isArray((snap as any).expenses) ? (snap as any).expenses : [];
            const tillSalesGross = Number((snap as any).tillSalesGross || 0);
            totals = await computeSnapshotTotals({ outletName: outlet, openingSnapshot, closings: clos, expenses: exps, deposits: depositsRes, tillSalesGross });
          }
        }
        const expectedSales = Number(totals?.expectedSales || 0);
        const expensesSum = Number(totals?.expenses || 0);
        const verifiedDeposits = Number(totals?.verifiedDeposits || 0);
        const cashAtTill = Math.max(0, expectedSales - verifiedDeposits - expensesSum);
        const variance = expectedSales - verifiedDeposits; // exclude expenses per existing dashboards
        summary = { expectedSales, expenses: expensesSum, deposits: verifiedDeposits, cashAtTill, variance };
      } catch {
        summary = null;
      }
    }

    return NextResponse.json({ ok: true, date, outlet, summary, deposits, expenses, closings, supply });
  } catch (e:any) {
    console.warn('overview.fail', e?.message || e);
    return NextResponse.json({ ok:false, error:'Server error' }, { status:500 });
  }
}