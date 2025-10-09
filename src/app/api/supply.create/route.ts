// src/app/api/supply.create/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enqueueOpsEvent } from '@/lib/opsEvents';

const makeId = () => (typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2,8));

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const body = await req.json().catch(()=>({}));
  const { outletId, supplierId, eta, ref, items, personId, personRole } = body || {};
  if (!outletId || !supplierId || !Array.isArray(items) || !items.length) return NextResponse.json({ ok: false, error: 'missing' }, { status: 400 });
  // idempotency: if ref provided and exists, return existing
  if (ref) {
    const existing = await (prisma as any).supply.findUnique({ where: { ref } }).catch(()=>null);
    if (existing) return NextResponse.json({ ok: true, supply: existing });
  }
  const id = makeId();
  const sup = await (prisma as any).supply.create({ data: { id, outlet_id: outletId, supplier_id: supplierId, eta: eta || null, ref: ref || null, status: 'submitted', created_by_role: personRole || null, created_by_person: personId || null } }).catch((e:any)=>{ throw e; });
  for (const it of items) {
    await (prisma as any).supplyItem.create({ data: { id: makeId(), supply_id: sup.id, product_id: it.productId, qty: it.qty, unit: it.unit, unit_price: it.unitPrice || null } }).catch(()=>{});
  }
  // emit event
  await enqueueOpsEvent({ id: makeId(), type: 'SUPPLY_SUBMITTED', entityId: sup.id, outletId, supplierId, actorRole: personRole || null, dedupeKey: `SUPPLY_SUBMITTED:${sup.id}:1` }).catch(()=>{});
  return NextResponse.json({ ok: true, supply: sup });
}
