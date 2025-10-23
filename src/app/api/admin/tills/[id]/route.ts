import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: Request, { params }: any) {
  try {
    const id = params.id;
    const body = await req.json();
    const update = await (prisma as any).till.update({ where: { id }, data: body });
    return NextResponse.json({ ok: true, data: update });
  } catch (e:any) { return NextResponse.json({ ok: false, error: String(e) }, { status: 500 }); }
}

export async function DELETE(req: Request, { params }: any) {
  try {
    const id = params.id;
    await (prisma as any).till.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e:any) { return NextResponse.json({ ok: false, error: String(e) }, { status: 500 }); }
}
