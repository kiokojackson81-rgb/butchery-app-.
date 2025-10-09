// src/app/api/suppliers/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const outlet = url.searchParams.get('outlet');
  const active = url.searchParams.get('active');
  const where: any = {};
  if (active === 'true') where.status = 'active';
  // If outlet provided, determine supplier outlets
  if (outlet) {
    // Join SupplierOutlet or Supplier mapping via phoneMapping if exists
    const rows = await (prisma as any).$queryRawUnsafe(`
      SELECT s.id, s.name, s.phone_e164 as "phoneE164", coalesce(so.active, true) as "activeForOutlet"
      FROM "Supplier" s
      LEFT JOIN "SupplierOutlet" so ON so.supplier_id = s.id AND so.outlet_id = $1
      WHERE ($2 IS NULL OR s.status = $2)
    `, outlet, active === 'true' ? 'active' : null);
    return NextResponse.json({ ok: true, suppliers: Array.isArray(rows) ? rows : [] });
  }
  const sups = await (prisma as any).supplier.findMany({ where, select: { id: true, name: true, phoneE164: true, status: true } });
  return NextResponse.json({ ok: true, suppliers: sups.map((s:any)=>({ id: s.id, name: s.name, phoneE164: s.phoneE164, activeForOutlet: true })) });
}
