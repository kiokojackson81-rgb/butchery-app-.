import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { APP_TZ, todayLocalISO, addDaysISO } from "@/server/trading_period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function fail(msg: string, code = 400) { return NextResponse.json({ ok: false, error: msg }, { status: code }); }

export async function POST(req: Request) {
  try {
    const adminHeader = req.headers.get('x-admin-auth');
    if (adminHeader !== 'true') return fail('forbidden', 403);

    const body = await req.json().catch(()=>({}));
    const id = body.id as string;
    const to = String(body.to || '').toLowerCase(); // 'current' | 'previous'
    if (!id) return fail('missing id');
    if (to !== 'current' && to !== 'previous') return fail('invalid to');

    const p = await (prisma as any).payment.findUnique({ where: { id }, select: { id: true, outletCode: true, status: true } });
    if (!p) return fail('payment_not_found', 404);

    // Build a timestamp in local trading day window
    const tzOffset = APP_TZ === 'Africa/Nairobi' ? '+03:00' : '+00:00';
    const todayISO = todayLocalISO();
    const dayISO = to === 'current' ? todayISO : addDaysISO(todayISO, -1);
    // 12:00 local time is safely within the day window
    const newCreatedAt = new Date(`${dayISO}T12:00:00${tzOffset}`);

    const updated = await (prisma as any).payment.update({ where: { id }, data: { createdAt: newCreatedAt }, select: { id: true, createdAt: true, outletCode: true, amount: true, status: true } });
    return NextResponse.json({ ok: true, payment: updated });
  } catch (e: any) {
    return fail(String(e) || 'error', 500);
  }
}
