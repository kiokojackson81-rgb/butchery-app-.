// scripts/db-snapshot.mjs
// Prints small snapshots for verification used in final report.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

async function main() {
  const out = { Outlet: [], PersonCode: [], AttendantAssignment: [] };
  try {
    out.Outlet = await prisma.$queryRawUnsafe('SELECT name, code, active FROM "Outlet" ORDER BY name LIMIT 5');
  } catch {}
  try {
    out.PersonCode = await prisma.$queryRawUnsafe('SELECT code, name, role, active FROM "PersonCode" ORDER BY code LIMIT 5');
  } catch {}
  try {
    out.AttendantAssignment = await prisma.$queryRawUnsafe('SELECT code, outlet, "productKeys" FROM "AttendantAssignment" ORDER BY code LIMIT 5');
  } catch {}
  console.log(JSON.stringify({ ok: true, ...out }, null, 2));
}

main().finally(() => prisma.$disconnect());
