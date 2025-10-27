#!/usr/bin/env node
/**
 * scripts/admin/swap-tills-by-outlet.mjs
 *
 * Safely reassign tillNumber and storeNumber for BARAKA_C and GENERAL by outletCode.
 * This script runs a guarded transaction and refuses to run if the target tillNumbers
 * are already in use by other Till rows.
 *
 * USAGE (run from project root):
 *   DATABASE_URL="your_db" node scripts/admin/swap-tills-by-outlet.mjs
 *
 * WARNING: This will modify the database pointed to by DATABASE_URL. Confirm before running.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Targets requested
  const BARAKA_OUTLET = 'BARAKA_C';
  const GENERAL_OUTLET = 'GENERAL';

  const BARAKA_TARGET = { tillNumber: '3574871', storeNumber: '3574835' };
  const GENERAL_TARGET = { tillNumber: '3574947', storeNumber: '3574821' };

  console.log('Starting swap of tills by outletCode:', BARAKA_OUTLET, '<->', GENERAL_OUTLET);

  const baraka = await prisma.till.findFirst({ where: { outletCode: BARAKA_OUTLET } });
  const general = await prisma.till.findFirst({ where: { outletCode: GENERAL_OUTLET } });

  if (!baraka) {
    console.error(`Could not find Till row for outletCode=${BARAKA_OUTLET}`);
    process.exitCode = 2;
    return;
  }
  if (!general) {
    console.error(`Could not find Till row for outletCode=${GENERAL_OUTLET}`);
    process.exitCode = 2;
    return;
  }

  console.log('Found rows:');
  console.log(' - BARAKA_C id=', baraka.id, 'current tillNumber=', baraka.tillNumber);
  console.log(' - GENERAL  id=', general.id, 'current tillNumber=', general.tillNumber);

  // Ensure no other till (outside these two rows) already uses the target tillNumbers
  const conflicts = await prisma.till.findMany({ where: { tillNumber: { in: [BARAKA_TARGET.tillNumber, GENERAL_TARGET.tillNumber] }, id: { notIn: [baraka.id, general.id] } } });
  if (conflicts.length > 0) {
    console.error('Conflict: the following Till rows already use one of the target tillNumbers:');
    for (const c of conflicts) console.error(` - id=${c.id} outletCode=${c.outletCode} tillNumber=${c.tillNumber}`);
    console.error('Aborting to avoid accidental collisions. Resolve conflicts first.');
    process.exitCode = 3;
    return;
  }

  // Run transactional update
  try {
    const [u1, u2] = await prisma.$transaction([
      prisma.till.update({ where: { id: baraka.id }, data: { tillNumber: BARAKA_TARGET.tillNumber, storeNumber: BARAKA_TARGET.storeNumber } }),
      prisma.till.update({ where: { id: general.id }, data: { tillNumber: GENERAL_TARGET.tillNumber, storeNumber: GENERAL_TARGET.storeNumber } }),
    ]);

    console.log('Update successful. New rows:');
    console.log(' - BARAKA_C ->', u1.tillNumber, u1.storeNumber);
    console.log(' - GENERAL  ->', u2.tillNumber, u2.storeNumber);
  } catch (err) {
    console.error('Transaction failed:', String(err));
    process.exitCode = 4;
  }
}

main()
  .catch((e) => { console.error('Script error:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
