// src/app/api/supervisor/commissions/export/route.ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function ymd(s:string){return s;}
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
function enumerateDays(start: string, end: string): string[] { const days: string[] = []; let cur = ymdToDate(start); const last = ymdToDate(end); while (cur.getTime() <= last.getTime()) { days.push(toYMD(cur)); cur.setUTCDate(cur.getUTCDate() + 1); } return days; }

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    const range = (searchParams.get('range') || 'period') as 'day'|'week'|'period';
    const outletParam = searchParams.get('outlet');
    if (!date) return new Response('Missing date', { status: 400 });

    let outlets: string[] = [];
    if (outletParam && outletParam !== '__ALL__') outlets = [outletParam];
    else {
      const actives = await (prisma as any).outlet.findMany({ where: { active: true } }).catch(()=>[]);
      outlets = (actives||[]).map((o:any)=>o.name).filter(Boolean);
    }
    if (!outlets.length) return new Response('No outlets', { status: 200 });

    const anchor = ymdToDate(date);
    let days: string[] = [];
    if (range === 'day') days = [date];
    else if (range === 'week') days = enumerateDays(toYMD(startOfISOWeek(anchor)), toYMD(endOfISOWeek(anchor)));
    else { const pr = commissionPeriodRange(anchor); days = enumerateDays(pr.start, pr.end); }

    // Headers
    const header = ['date','outlet','salesKsh','expensesKsh','wasteKsh','profitKsh','commissionRate','commissionKsh','status','approvedAt','paidAt','note'].join(',') + '\n';

    // Streaming body
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode(header));
        for (const day of days) {
          for (const out of outlets) {
            try {
              const kpis = await (prisma as any).attendantKPI.findMany({ where: { date: day, outletName: out } });
              const sup = await (prisma as any).supervisorCommission.findUnique({ where: { date_outletName: { date: day, outletName: out } } }).catch(()=>null);
              const salesKsh = kpis.reduce((a:number,k:any)=>a+Number(k.sales||0),0);
              const expensesKsh = kpis.reduce((a:number,k:any)=>a+Number(k.expenses||0),0);
              const wasteKsh = kpis.reduce((a:number,k:any)=>a+Number(k.wasteCost||0),0);
              const profitKsh = kpis.reduce((a:number,k:any)=>a+Number(k.np || (k.sales||0)-(k.expenses||0)-(k.wasteCost||0)),0);
              const commissionKsh = kpis.reduce((a:number,k:any)=>a+Number(k.commissionAmount||0),0);
              const rateSource = kpis.filter((k:any)=>Number(k.commissionKg||0)>0);
              const commissionRate = rateSource.length ? rateSource.reduce((a:number,k:any)=>a+Number(k.commissionRate||0),0)/rateSource.length : (kpis.length ? kpis.reduce((a:number,k:any)=>a+Number(k.commissionRate||0),0)/kpis.length : 0);
              const status = sup?.status || (commissionKsh>0?'CALCULATED':'NONE');
              const approvedAt = sup?.approvedAt ? new Date(sup.approvedAt).toISOString() : '';
              const paidAt = sup?.paidAt ? new Date(sup.paidAt).toISOString() : '';
              const note = (sup?.note||'').replace(/,/g,';');
              const num = (n:number)=>Number(n||0).toFixed(2);
              const line = [day,out,num(salesKsh),num(expensesKsh),num(wasteKsh),num(profitKsh),num(commissionRate),num(commissionKsh),status,approvedAt,paidAt,note].join(',')+'\n';
              controller.enqueue(new TextEncoder().encode(line));
            } catch {
              const line = [day,out,'0','0','0','0','0','0','ERROR','','',''].join(',')+'\n';
              controller.enqueue(new TextEncoder().encode(line));
            }
          }
        }
        controller.close();
      }
    });
    return new Response(stream, { headers: { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':`attachment; filename=commissions_${date}_${range}.csv` } });
  } catch (e:any) {
    return new Response('Server error: '+String(e?.message||e), { status: 500 });
  }
}
