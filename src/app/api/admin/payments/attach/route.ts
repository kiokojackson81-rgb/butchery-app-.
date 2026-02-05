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
    const { id, outlet, shortcode, storeNumber, headOfficeNumber } = body;
    if (!id || !outlet) return NextResponse.json({ ok: false, error: 'id and outlet required' }, { status: 400 });
    const data: any = { outletCode: outlet };

    // If any till identifier is provided, validate it exists in the Till table
    const whereAny: any[] = [];
    if (shortcode) whereAny.push({ tillNumber: String(shortcode) });
    if (storeNumber) whereAny.push({ storeNumber: String(storeNumber) });
    if (headOfficeNumber) whereAny.push({ headOfficeNumber: String(headOfficeNumber) });

    if (whereAny.length > 0) {
      const till = await (prisma as any).till.findFirst({ where: { OR: whereAny } });
      if (!till) return NextResponse.json({ ok: false, error: 'till not found' }, { status: 400 });
      // Use canonical values from the Till row to avoid typos
      data.businessShortCode = till.tillNumber;
      data.storeNumber = till.storeNumber;
      data.headOfficeNumber = till.headOfficeNumber;
    }

    const updated = await (prisma as any).payment.update({ where: { id }, data });
    return NextResponse.json({ ok: true, data: updated });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
