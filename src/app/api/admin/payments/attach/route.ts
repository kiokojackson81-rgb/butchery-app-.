import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    // Basic admin guard: expect header X-Admin-Auth === 'true' set by client when admin sessionStorage exists
    const adminHeader = req.headers.get('x-admin-auth');
    if (adminHeader !== 'true') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    const body = await req.json();
    const { id, outlet } = body;
    if (!id || !outlet) return NextResponse.json({ ok: false, error: 'id and outlet required' }, { status: 400 });
    const updated = await (prisma as any).payment.update({ where: { id }, data: { outletCode: outlet } });
    return NextResponse.json({ ok: true, data: updated });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
