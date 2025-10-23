import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { label, tillNumber, storeNumber, headOfficeNumber, outletCode, isActive } = body;
    if (!label || !tillNumber || !storeNumber || !headOfficeNumber || !outletCode) return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
    // basic numeric checks
    if (!/^[0-9]+$/.test(tillNumber) || !/^[0-9]+$/.test(storeNumber) || !/^[0-9]+$/.test(headOfficeNumber)) return NextResponse.json({ ok: false, error: 'numbers must be numeric' }, { status: 400 });
    const existing = await (prisma as any).till.findUnique({ where: { tillNumber } });
    if (existing) return NextResponse.json({ ok: false, error: 'tillNumber exists' }, { status: 409 });
    const created = await (prisma as any).till.create({ data: { label, tillNumber, storeNumber, headOfficeNumber, outletCode, isActive: Boolean(isActive) } });
    return NextResponse.json({ ok: true, data: created });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
