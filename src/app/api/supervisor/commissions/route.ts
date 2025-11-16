// src/app/api/supervisor/commissions/route.ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Helper date utilities (UTC, ISO week and commission period boundaries)
function ymdToDate(s: string): Date { return new Date(s + 'T00:00:00.000Z'); }
function toYMD(d: Date): string { return d.toISOString().slice(0,10); }
function startOfISOWeek(d: Date): Date { const dt = new Date(d); const day = dt.getUTCDay() || 7; if (day !== 1) dt.setUTCDate(dt.getUTCDate() - (day - 1)); dt.setUTCHours(0,0,0,0); return dt; }
function endOfISOWeek(d: Date): Date { const s = startOfISOWeek(d); const e = new Date(s); e.setUTCDate(e.getUTCDate() + 6); return e; }
function commissionPeriodRange(d: Date): { start: string; end: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  let start: Date; let end: Date;
  if (day >= 24) { start = new Date(Date.UTC(y, m, 24)); end = new Date(Date.UTC(y, m + 1, 23)); }
  else { start = new Date(Date.UTC(y, m - 1, 24)); end = new Date(Date.UTC(y, m, 23)); }
  return { start: toYMD(start), end: toYMD(end) };
}
function enumerateDays(start: string, end: string): string[] {
  const days: string[] = []; let cur = ymdToDate(start); const last = ymdToDate(end);
  while (cur.getTime() <= last.getTime()) { days.push(toYMD(cur)); cur.setUTCDate(cur.getUTCDate() + 1); }
  return days;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    const range = (searchParams.get('range') || 'period') as 'day'|'week'|'period';
    const outletParam = searchParams.get('outlet'); // single outlet or __ALL__ / undefined
    if (!date) return Response.json({ ok: false, error: 'Missing date' }, { status: 400 });

    // Resolve outlets
    let outlets: string[] = [];
    if (outletParam && outletParam !== '__ALL__') {
      outlets = [outletParam];
    } else {
      const actives = await (prisma as any).outlet.findMany({ where: { active: true } }).catch(()=>[]);
      outlets = (actives || []).map((o: any) => o.name).filter(Boolean);
    }
    if (outlets.length === 0) return Response.json({ ok: true, rows: [] });

    // Determine date set
    const anchor = ymdToDate(date);
    let days: string[] = [];
    if (range === 'day') days = [date];
    else if (range === 'week') days = enumerateDays(toYMD(startOfISOWeek(anchor)), toYMD(endOfISOWeek(anchor)));
    else { const pr = commissionPeriodRange(anchor); days = enumerateDays(pr.start, pr.end); }

  type CommissionRow = { id: string; date: string; outletName: string; salesKsh: number; expensesKsh: number; wasteKsh: number; profitKsh: number; commissionRate: number; commissionKsh: number; status?: string | null; note?: string | null; approvedAt?: string | null; paidAt?: string | null };
    const rows: CommissionRow[] = [];

    // Parallel per-day/per-outlet queries (limit concurrency implicitly by Promise.all outer loops size)
    for (const day of days) {
      const perOutlet = await Promise.all(outlets.map(async (out) => {
        try {
          // Attendant KPIs for the outlet/day (weight + commission specifics)
          const kpis = await (prisma as any).attendantKPI.findMany({ where: { date: day, outletName: out } });
          // Supervisor-level commission status record (may be absent)
          const sup = await (prisma as any).supervisorCommission.findUnique({ where: { date_outletName: { date: day, outletName: out } } }).catch(()=>null);
          const salesKsh = kpis.reduce((a: number, k: any) => a + Number(k.sales || 0), 0);
          const expensesKsh = kpis.reduce((a: number, k: any) => a + Number(k.expenses || 0), 0);
          const wasteKsh = kpis.reduce((a: number, k: any) => a + Number(k.wasteCost || 0), 0);
          const profitKsh = kpis.reduce((a: number, k: any) => a + Number(k.np || (k.sales||0) - (k.expenses||0) - (k.wasteCost||0)), 0);
          const commissionKsh = kpis.reduce((a: number, k: any) => a + Number(k.commissionAmount || 0), 0);
          // Average rate among attendants with commission activity, else among all
          const rateSource = kpis.filter((k: any) => Number(k.commissionKg || 0) > 0);
          const commissionRate = rateSource.length ? rateSource.reduce((a: number, k: any) => a + Number(k.commissionRate || 0), 0) / rateSource.length : (kpis.length ? kpis.reduce((a: number, k: any) => a + Number(k.commissionRate || 0), 0) / kpis.length : 0);
          const status = sup?.status || (commissionKsh > 0 ? 'CALCULATED' : 'NONE');
          const note = sup?.note || '';
          const approvedAt = sup?.approvedAt ? new Date(sup.approvedAt).toISOString() : null;
          const paidAt = sup?.paidAt ? new Date(sup.paidAt).toISOString() : null;
          return { id: `${day}_${out}`, date: day, outletName: out, salesKsh, expensesKsh, wasteKsh, profitKsh, commissionRate, commissionKsh, status, note, approvedAt, paidAt } as CommissionRow;
        } catch {
          return { id: `${day}_${out}`, date: day, outletName: out, salesKsh: 0, expensesKsh: 0, wasteKsh: 0, profitKsh: 0, commissionRate: 0, commissionKsh: 0, status: 'NONE', note: 'error' } as CommissionRow;
        }
      }));
      rows.push(...perOutlet);
    }

    // Basic sort: date asc then outlet asc
    rows.sort((a, b) => a.date === b.date ? a.outletName.localeCompare(b.outletName) : a.date.localeCompare(b.date));
    return Response.json({ ok: true, rows });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
