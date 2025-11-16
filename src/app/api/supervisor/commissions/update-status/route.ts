// src/app/api/supervisor/commissions/update-status/route.ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(()=> ({}));
    const { date, outletName, status, note } = body || {};
    if (!date || !outletName || !status) return Response.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    if (!['CALCULATED','APPROVED','PAID'].includes(status)) return Response.json({ ok:false, error:'Invalid status' }, { status: 400 });
    // Upsert record + timestamps
    const existing = await (prisma as any).supervisorCommission.findUnique({ where: { date_outletName: { date, outletName } } }).catch(()=>null);
    const data: any = { status, note: typeof note === 'string' ? note.slice(0,200) : existing?.note || null };
    if (status === 'APPROVED' && !existing?.approvedAt) data.approvedAt = new Date();
    if (status === 'PAID') {
      if (!existing?.approvedAt) data.approvedAt = new Date();
      data.paidAt = new Date();
    }
    const rec = existing
      ? await (prisma as any).supervisorCommission.update({ where: { id: existing.id }, data })
      : await (prisma as any).supervisorCommission.create({ data: { date, outletName, ...data } });
    return Response.json({ ok: true, record: rec });
  } catch (e:any) {
    return Response.json({ ok:false, error:String(e?.message||e) }, { status: 500 });
  }
}
