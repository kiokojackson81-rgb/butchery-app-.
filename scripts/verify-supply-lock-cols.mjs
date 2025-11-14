#!/usr/bin/env node
// Script: verify-supply-lock-cols.mjs
// Purpose: Check whether SupplyOpeningRow has lockedAt & lockedBy columns.
// Exit codes: 0 => columns present; 2 => columns missing; 1 => unexpected error.
// Usage: node scripts/verify-supply-lock-cols.mjs

// Import compiled TypeScript via ts-node register fallback if needed.
// We attempt .ts import because prisma.ts is TypeScript. Node ESM cannot directly import .ts without a loader.
// Use dynamic import with extension adjustment.
// Script context: allowed to create its own PrismaClient instance (guideline restriction applies to routes).
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ log: ['error'] });

async function main() {
  const result = { ok: true, hasLockCols: false, legacyMode: true, error: null };
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='SupplyOpeningRow' AND column_name IN ('lockedAt','lockedBy')`
    );
    const names = new Set(rows.map((r) => r.column_name));
    result.hasLockCols = names.has('lockedAt') && names.has('lockedBy');
    result.legacyMode = !result.hasLockCols;
  } catch (err) {
    result.ok = false;
    result.error = String(err?.message || err);
  } finally {
    try { await prisma.$disconnect(); } catch {}
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) return process.exit(1);
  return process.exit(result.hasLockCols ? 0 : 2);
}

main();
