import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const rows = await (prisma as any).till.findMany({
      where: { isActive: true },
      orderBy: [{ outletCode: 'asc' as const }, { label: 'asc' as const }],
      select: { label: true, tillNumber: true, storeNumber: true, headOfficeNumber: true, outletCode: true },
    });
    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
