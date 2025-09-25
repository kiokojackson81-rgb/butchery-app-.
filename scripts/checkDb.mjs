// scripts/checkDb.mjs
// Purpose: Quick sanity checks to ensure Prisma can connect and see expected tables/rows.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['error']
});

async function main() {
  const results = { currentUser: null, counts: [] };
  try {
    const [{ current_user }] = await prisma.$queryRawUnsafe(`SELECT current_user`);
    results.currentUser = current_user;
  } catch (err) {
    console.error('Failed to query current_user:', err?.message || err);
  }

  const tables = ['PersonCode', 'AttendantAssignment'];
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
