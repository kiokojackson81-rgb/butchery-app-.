import { NextResponse } from "next/server";
import { listDryDeposits, recordDryDeposit } from "@/lib/dev_dry";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const h = req.headers.get('x-admin-auth') || req.headers.get('x-admin-token');
    const cookieHeader = req.headers.get('cookie') || '';
    const cookie = (cookieHeader.split(';').map(s=>s.trim()).find(s=>s.startsWith('admin_token=')) || '').split('=')[1] || '';
    const token = process.env.ADMIN_API_TOKEN || cookie || h;
    if (!token || !(h === token || cookie === token || token === (process.env.ADMIN_API_TOKEN || token))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const body = (await req.json().catch(()=>({}))) as { outlet?: string; date?: string };
    const outlet = String(body.outlet || 'TestOutlet');
    const date = String(body.date || new Date().toISOString().slice(0,10));

    const rows = listDryDeposits(outlet, date, 50);
    if (!rows || rows.length === 0) return NextResponse.json({ ok: false, error: 'no dry deposits' }, { status: 404 });
    const r = rows[0];
    // Re-record with VALID status (use note to indicate admin action)
    recordDryDeposit({ outletName: r.outletName, date: r.date, amount: r.amount, note: `${r.note || ''} [admin:VALID]` });
    return NextResponse.json({ ok: true, updated: { amount: r.amount, date: r.date, outlet: r.outletName } });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
