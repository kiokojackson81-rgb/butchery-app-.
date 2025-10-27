import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const seed = [
      { label: 'Bright', tillNumber: '3574877', storeNumber: '3574841', headOfficeNumber: '3574813', outletCode: 'BRIGHT' },
      { label: 'Baraka A', tillNumber: '3574875', storeNumber: '3574839', headOfficeNumber: '3574813', outletCode: 'BARAKA_A' },
      { label: 'Baraka B', tillNumber: '3574873', storeNumber: '3574837', headOfficeNumber: '3574813', outletCode: 'BARAKA_B' },
  // swapped: assign 3574871 to Baraka C and 3574947 to General
  { label: 'Baraka C', tillNumber: '3574871', storeNumber: '3574835', headOfficeNumber: '3574813', outletCode: 'BARAKA_C' },
  { label: 'General', tillNumber: '3574947', storeNumber: '3574821', headOfficeNumber: '3574813', outletCode: 'GENERAL' },
    ];
    for (const t of seed) {
      const existing = await (prisma as any).till.findUnique({ where: { tillNumber: t.tillNumber } });
      if (existing) {
        await (prisma as any).till.update({ where: { id: existing.id }, data: { ...t, isActive: true } });
      } else {
        await (prisma as any).till.create({ data: t });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[seed tills] err', String(e));
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
