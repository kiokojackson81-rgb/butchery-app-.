// src/lib/opsEvents.ts
import { prisma } from '@/lib/prisma';

export type OpsEventType = 'SUPPLIER_UPSERT' | 'SUPPLY_SUBMITTED' | 'SUPPLY_DISPATCHED' | 'SUPPLY_RECEIVED' | 'SUPPLY_DISPUTED';

export async function ensureOpsEventTable() {
  // Create a minimal OpsEvent table if missing. Prefer migrations in prod.
  try {
    await (prisma as any).$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "OpsEvent" (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        entity_id TEXT,
        outlet_id TEXT,
        supplier_id TEXT,
        actor_role TEXT,
        dedupe_key TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        handled_at TIMESTAMP WITH TIME ZONE NULL
      );
    `);
  } catch (e) {
    // no-op: migrations preferred for production
    console.error('ensureOpsEventTable failed', String(e));
  }
}

export async function enqueueOpsEvent(e: { id: string; type: OpsEventType; entityId?: string | null; outletId?: string | null; supplierId?: string | null; actorRole?: string | null; dedupeKey?: string | null; }) {
  try {
    await ensureOpsEventTable();
    await (prisma as any).opsEvent.upsert({
      where: { id: e.id },
      update: {
        type: e.type,
        entity_id: e.entityId || null,
        outlet_id: e.outletId || null,
        supplier_id: e.supplierId || null,
        actor_role: e.actorRole || null,
        dedupe_key: e.dedupeKey || null,
        handled_at: null,
      },
      create: {
        id: e.id,
        type: e.type,
        entity_id: e.entityId || null,
        outlet_id: e.outletId || null,
        supplier_id: e.supplierId || null,
        actor_role: e.actorRole || null,
        dedupe_key: e.dedupeKey || null,
      }
    });
  } catch (err) {
    console.error('enqueueOpsEvent failed', String(err));
    // fallback: try raw insert
    try {
      await (prisma as any).$executeRawUnsafe(`INSERT INTO "OpsEvent" (id, type, entity_id, outlet_id, supplier_id, actor_role, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET handled_at = NULL`, e.id, e.type, e.entityId || null, e.outletId || null, e.supplierId || null, e.actorRole || null, e.dedupeKey || null);
    } catch (e) {
      console.error('enqueueOpsEvent raw insert failed', String(e));
    }
  }
}

export async function fetchUnprocessedOpsEvents(limit = 100) {
  await ensureOpsEventTable();
  const rows = await (prisma as any).$queryRawUnsafe(`SELECT id, type, entity_id as "entityId", outlet_id as "outletId", supplier_id as "supplierId", actor_role as "actorRole", dedupe_key as "dedupeKey", created_at as "createdAt" FROM "OpsEvent" WHERE handled_at IS NULL ORDER BY created_at ASC LIMIT ${Number(limit)}`);
  return Array.isArray(rows) ? rows : [];
}

export async function markEventHandled(id: string) {
  try {
    await (prisma as any).opsEvent.update({ where: { id }, data: { handled_at: new Date() } });
  } catch (e) {
    try { await (prisma as any).$executeRawUnsafe(`UPDATE "OpsEvent" SET handled_at = NOW() WHERE id = $1`, id); } catch {}
  }
}
