#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
  });
  try {
    const raw = (process.argv[2] || process.env.CODE || '').trim();
    if (!raw) {
      console.error('Usage: node -r dotenv/config scripts/checkAssignment.mjs <code>');
      process.exit(2);
    }
    const norm = raw.replace(/\s+/g, '').toLowerCase();
    const rows = await prisma.$queryRawUnsafe(
      'SELECT code, outlet, "productKeys", "updatedAt" FROM "AttendantAssignment" WHERE code = $1',
      norm
    );
    if (!rows || rows.length === 0) {
      console.log(JSON.stringify({ ok: false, code: norm, found: false }, null, 2));
    } else {
      const r = rows[0];
      console.log(JSON.stringify({ ok: true, code: r.code, outlet: r.outlet, productKeys: r.productKeys, updatedAt: r.updatedAt }, null, 2));
    }
  } catch (e) {
    console.error('Error:', e?.message || e);
    process.exit(1);
  }
}

main();
