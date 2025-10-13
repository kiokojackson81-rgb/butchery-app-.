import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getCommissionPeriodFor } from "@/server/commission";

function esc(v: any): string {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || new Date().toISOString().slice(0,10)).slice(0,10);
    const outlet = (searchParams.get("outlet") || "").trim();
    const supCode = (searchParams.get("supervisor") || "").trim() || undefined;
    const status = (searchParams.get("status") || "").trim();
  const idsRaw = (searchParams.get("ids") || "").trim();
  const ids = idsRaw ? idsRaw.split(",").map(s=>s.trim()).filter(Boolean) : [];
  const { key } = getCommissionPeriodFor(date);
  const where: any = { periodKey: key };
    if (outlet) where.outletName = outlet;
    if (supCode) where.supervisorCode = supCode;
    if (status) where.status = status;
  if (ids.length) (where as any).id = { in: ids };
    const rows: any[] = await (prisma as any).supervisorCommission.findMany({ where, orderBy: [{ date: 'asc' }, { outletName: 'asc' }] });

    const head = [
      'id','date','outlet','supervisor','phone','salesKsh','expensesKsh','wasteKsh','profitKsh','commissionRate','commissionKsh','status','note'
    ];
    const lines: string[] = [];
    lines.push(head.join(','));
    for (const r of rows) {
      const row = [
        r.id,
        r.date,
        r.outletName,
        r.supervisorCode ?? '',
        r.supervisorPhone ?? '',
        String(r.salesKsh ?? 0),
        String(r.expensesKsh ?? 0),
        String(r.wasteKsh ?? 0),
        String(r.profitKsh ?? 0),
        String(r.commissionRate ?? 0),
        String(r.commissionKsh ?? 0),
        r.status ?? '',
        r.note ?? '',
      ].map(esc);
      lines.push(row.join(','));
    }
    const csv = lines.join('\n');
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
