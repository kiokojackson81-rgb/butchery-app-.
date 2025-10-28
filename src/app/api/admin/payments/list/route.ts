import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    // Basic admin guard: expect header X-Admin-Auth === 'true'
    const adminHeader = req.headers.get('x-admin-auth');
    if (adminHeader !== 'true') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

    const url = new URL(req.url);
    const take = Math.min(Number(url.searchParams.get('take') || 20), 100);

    const rows = await (prisma as any).payment.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        amount: true,
        outletCode: true,
        msisdn: true,
        status: true,
        mpesaReceipt: true,
        businessShortCode: true,
        accountReference: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
