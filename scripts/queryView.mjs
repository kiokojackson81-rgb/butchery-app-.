import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const rows = await prisma.$queryRawUnsafe('SELECT * FROM public.vw_codes_norm LIMIT 5;');
    console.log('vw_codes_norm (LIMIT 5):');
    console.log(JSON.stringify(rows, null, 2));

    const clashes = await prisma.$queryRawUnsafe(`
      SELECT canon_num, array_agg(raw_code) AS codes
      FROM public.vw_codes_norm
      WHERE canon_num <> ''
      GROUP BY canon_num
      HAVING COUNT(*) > 1
      ORDER BY canon_num
      LIMIT 10;
    `);
    console.log('\nClash grouping (by canon_num):');
    console.log(JSON.stringify(clashes, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
