import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    // Desired mapping: swap Baraka B and General tills
    // - Baraka B gets 3574947 (store stays 3574837)
    // - General gets 3574873 (store stays 3574821)
    const seed = [
      { label: 'Bright',   tillNumber: '3574877', storeNumber: '3574841', headOfficeNumber: '3574813', outletCode: 'BRIGHT' },
      { label: 'Baraka A', tillNumber: '3574875', storeNumber: '3574839', headOfficeNumber: '3574813', outletCode: 'BARAKA_A' },
      { label: 'Baraka B', tillNumber: '3574947', storeNumber: '3574837', headOfficeNumber: '3574813', outletCode: 'BARAKA_B' },
      { label: 'Baraka C', tillNumber: '3574871', storeNumber: '3574835', headOfficeNumber: '3574813', outletCode: 'BARAKA_C' },
      { label: 'General',  tillNumber: '3574873', storeNumber: '3574821', headOfficeNumber: '3574813', outletCode: 'GENERAL' },
    ];

    // Upsert by tillNumber (unique) and ensure exactly one ACTIVE per outlet from the target mapping
    for (const t of seed) {
      const existing = await (prisma as any).till.findUnique({ where: { tillNumber: t.tillNumber } });
      if (existing) {
        await (prisma as any).till.update({ where: { id: existing.id }, data: { ...t, isActive: true } });
      } else {
        await (prisma as any).till.create({ data: { ...t, isActive: true } });
      }
    }

    // Deactivate any extra tills for these outlets that are not the current mapping
    const byOutlet = new Map(seed.map((s) => [s.outletCode, s.tillNumber] as const));
    for (const [outletCode, keepTill] of byOutlet) {
      const others = await (prisma as any).till.findMany({ where: { outletCode, NOT: { tillNumber: keepTill } } });
      for (const row of others) {
        if (row.isActive) {
          await (prisma as any).till.update({ where: { id: row.id }, data: { isActive: false } });
        }
      }
    }

    return NextResponse.json({ ok: true, updated: seed.length });
  } catch (e: any) {
    console.error('[seed tills] err', String(e));
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// Allow GET to run the same idempotent seeding (useful for remote automation)
export async function GET(req: Request) {
  return POST(req);
}
