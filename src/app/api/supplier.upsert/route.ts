// src/app/api/supplier.upsert/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enqueueOpsEvent } from '@/lib/opsEvents';
// use crypto.randomUUID for ids
const makeId = () => (typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2,8));

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { id, name, phoneE164, status, outletIds } = body || {};
  if (!name || !phoneE164) return NextResponse.json({ ok: false, error: 'missing' }, { status: 400 });
  const s = await (prisma as any).supplier.upsert({ where: { id: id || '' }, update: { name, phoneE164, status }, create: { id: id || makeId(), name, phoneE164, status: status || 'active' } });
  // upsert SupplierOutlet rows
  if (Array.isArray(outletIds)) {
    for (const oid of outletIds) {
      await (prisma as any).supplierOutlet.upsert({ where: { supplier_id_outlet_id: { supplier_id: s.id, outlet_id: oid } }, update: { active: true }, create: { supplier_id: s.id, outlet_id: oid, active: true } }).catch(()=>{});
    }
  }
  // Emit OpsEvent
  await enqueueOpsEvent({ id: makeId(), type: 'SUPPLIER_UPSERT', entityId: s.id, outletId: (Array.isArray(outletIds) && outletIds[0]) || null, supplierId: s.id, actorRole: 'admin', dedupeKey: `SUPPLIER_UPSERT:${s.id}:1` }).catch(()=>{});
  return NextResponse.json({ ok: true, supplier: s });
}
