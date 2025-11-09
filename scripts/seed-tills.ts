import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEED: Array<{ label: string; tillNumber: string; storeNumber: string; headOfficeNumber: string; outletCode: any }> = [
  { label: 'Bright', tillNumber: '3574877', storeNumber: '3574841', headOfficeNumber: '3574813', outletCode: 'BRIGHT' },
  { label: 'Baraka A', tillNumber: '3574875', storeNumber: '3574839', headOfficeNumber: '3574813', outletCode: 'BARAKA_A' },
  // Updated mapping: Baraka B till/store swapped with General store per latest directive
  { label: 'Baraka B', tillNumber: '3574947', storeNumber: '3574821', headOfficeNumber: '3574813', outletCode: 'BARAKA_B' },
  { label: 'Baraka C', tillNumber: '3574871', storeNumber: '3574835', headOfficeNumber: '3574813', outletCode: 'BARAKA_C' },
  { label: 'General', tillNumber: '3574873', storeNumber: '3574837', headOfficeNumber: '3574813', outletCode: 'GENERAL' },
];

async function main() {
  for (const t of SEED) {
    const clientAny = prisma as any;
    const existing = await clientAny.till.findUnique({ where: { tillNumber: t.tillNumber } });
    if (existing) {
      console.log('exists', t.tillNumber);
      await clientAny.till.update({ where: { id: existing.id }, data: { label: t.label, storeNumber: t.storeNumber, headOfficeNumber: t.headOfficeNumber, outletCode: t.outletCode, isActive: true } });
    } else {
      console.log('create', t.tillNumber);
      await clientAny.till.create({ data: t as any });
    }
  }
}

main().then(() => { console.log('done'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
