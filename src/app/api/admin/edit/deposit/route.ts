import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyAttendants, notifySupplier } from "@/server/supervisor/supervisor.notifications";
import { computeDayTotals } from "@/server/finance";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

type Body = { id: string; amount?: number; note?: string; status?: "VALID"|"PENDING"|"INVALID" };

export async function POST(req: Request) {
  try {
    // Admin auth: require x-admin-auth or x-admin-token header
  const h = req.headers.get('x-admin-auth') || req.headers.get('x-admin-token');
  const cookieHeader = req.headers.get('cookie') || '';
  const cookie = (cookieHeader.split(';').map(s=>s.trim()).find(s=>s.startsWith('admin_token=')) || '').split('=')[1] || '';
  const token = process.env.ADMIN_API_TOKEN || cookie || h;
  if (!token || !(h === token || cookie === token || token === (process.env.ADMIN_API_TOKEN || token))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const body = (await req.json().catch(()=>({}))) as Body;
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
    const data: any = {};
    if (Number.isFinite(body.amount as any)) data.amount = Number(body.amount);
    if (typeof body.note === "string") data.note = body.note;
    if (typeof body.status === "string") data.status = body.status;
    if (Object.keys(data).length === 0) return NextResponse.json({ ok: false, error: "no fields to update" }, { status: 400 });

    const before = await (prisma as any).attendantDeposit.findUnique({ where: { id } }).catch(()=>null);
    if (!before) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const after = await (prisma as any).attendantDeposit.update({ where: { id }, data });

    try {
      const key = `admin_edit:${Date.now()}:deposit:${id}`;
      await (prisma as any).setting.create({ data: { key, value: { type: 'deposit', id, at: new Date().toISOString(), before, after } } });
    } catch {}

    // If status changed to VALID/INVALID, perform notifications and lightweight recompute
    try {
      if (data.status === 'VALID') {
        try {
          await notifyAttendants(after.outletName, `Deposit VALID: KSh ${after.amount} (${after.note || 'ref'})`);
        } catch {}
        try { await notifySupplier(after.outletName, `Deposit VALID for ${after.outletName}: KSh ${after.amount}`); } catch {}
        try { void computeDayTotals({ date: after.date, outletName: after.outletName }); } catch {}
      }
      if (data.status === 'INVALID') {
        try { await notifyAttendants(after.outletName, `Deposit INVALID: KSh ${after.amount} (${after.note || 'ref'})`); } catch {}
      }
    } catch {}

    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
