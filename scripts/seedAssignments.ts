#!/usr/bin/env tsx
// Simple Prisma seed to upsert a few attendant assignments
// Usage:
//   DATABASE_URL=<url> npx tsx scripts/seedAssignments.ts

import { prisma } from "@/lib/prisma";
import { canonFull } from "@/lib/codeNormalize";

const rows = [
  { code: "br1234", outlet: "Bright", productKeys: ["beef", "goat"] },
  { code: "kyaloa", outlet: "Baraka A", productKeys: ["beef"] },
  { code: "kithitoa", outlet: "HQ", productKeys: ["beef", "liver"] },
];

async function main() {
  console.log("Seeding AttendantAssignment rows (upsert)...");
  for (const r of rows) {
    const code = canonFull(r.code);
    if (!code) continue;
    try {
      await (prisma as any).attendantAssignment.upsert({
        where: { code },
        create: { code, outlet: r.outlet, productKeys: r.productKeys },
        update: { outlet: r.outlet, productKeys: r.productKeys },
      });
      console.log(`[ok] upserted ${code} -> ${r.outlet} [${r.productKeys.join(", ")}]`);
    } catch (e: any) {
      console.error(`[err] failed for ${code}`, e);
      if (String(e?.code || "") === "P2021") {
        console.error("It looks like the table doesn't exist. Run: prisma migrate deploy (use direct Neon URL if pooled times out)");
      }
    }
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => {
    await prisma.$disconnect();
  });
