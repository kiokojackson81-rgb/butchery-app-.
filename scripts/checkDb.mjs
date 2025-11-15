// scripts/checkDb.mjs
// Purpose: Quick sanity checks to ensure Prisma can connect and see expected tables/rows.

import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['error'],
});

const DEFAULT_CODES = 'br1234,kyaloa,kithitoa';
const DEFAULT_OUTLETS = 'Bright,Baraka A';

function parseList(value, fallback) {
  const source = typeof value === 'string' && value.trim() ? value : fallback;
  return source
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const codesToCheck = parseList(process.env.CHECK_CODES, DEFAULT_CODES).map((code) => code.toLowerCase());
const outletsToCheck = parseList(process.env.CHECK_OUTLETS, DEFAULT_OUTLETS);

async function main() {
  const results = { currentUser: null, currentDatabase: null, counts: [], attendantAssignmentCodes: [], outletsSnapshot: [], serverVersion: null };
  try {
    const [{ current_user }] = await prisma.$queryRawUnsafe(`SELECT current_user`);
    results.currentUser = current_user;
    const [{ current_database }] = await prisma.$queryRawUnsafe(`SELECT current_database()`);
    results.currentDatabase = current_database;
    const [{ server_version }] = await prisma.$queryRawUnsafe(`SHOW server_version`);
    results.serverVersion = server_version;
  } catch (err) {
    console.error('Failed to query connection metadata:', err?.message || err);
  }

  const tables = ['PersonCode', 'AttendantAssignment', 'PricebookRow', 'Payment', 'Till'];
  if (codesToCheck.length) {
    try {
      const rows = await prisma.$queryRaw`SELECT code FROM "AttendantAssignment" WHERE code IN (${Prisma.join(codesToCheck)}) ORDER BY code`;
      results.attendantAssignmentCodes = rows.map((row) => row.code);
    } catch (err) {
      console.error('Failed to verify AttendantAssignment codes:', err?.message || err);
    }
  }

  if (outletsToCheck.length) {
    try {
      const rows = await prisma.$queryRaw`SELECT id, name FROM "Outlet" WHERE name IN (${Prisma.join(outletsToCheck)}) ORDER BY name`;
      results.outletsSnapshot = rows.map((row) => ({ id: row.id, name: row.name }));
    } catch (err) {
      console.error('Failed to verify Outlet names:', err?.message || err);
    }
  }

  for (const t of tables) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT '${t}' AS t, COUNT(*)::int AS count FROM "${t}"`
      );
      // rows is an array with one object
      for (const r of rows) {
        results.counts.push({ table: r.t, count: r.count });
      }
    } catch (err) {
      const msg = err?.message || String(err);
      // Handle missing table or permission issues gracefully
      results.counts.push({ table: t, error: msg });
    }
  }

  console.log(JSON.stringify({ ok: true, ...results }, null, 2));
}

main()
  .catch((e) => {
    console.error('DB check failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
