#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";

async function main() {
  try {
    const rows: any[] = await (prisma as any).$queryRaw`
      SELECT canon_num, array_agg(raw_code ORDER BY raw_code) AS codes
      FROM "vw_codes_norm"
      WHERE canon_num <> ''
      GROUP BY canon_num
      HAVING COUNT(*) > 1
      ORDER BY canon_num
    `;

    if (Array.isArray(rows) && rows.length > 0) {
      console.error("Digit-core collisions detected:", JSON.stringify(rows, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log("No digit-core collisions detected across vw_codes_norm.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
