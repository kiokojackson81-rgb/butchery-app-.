// Simple Prisma seed to upsert a few attendant assignments
// Usage:
//   PowerShell:
//     $env:DATABASE_URL = "<your direct Neon URL>"; node scripts/seedAssignments.mjs
//   Or ensure DATABASE_URL is set in .env for your target DB.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = [
    { code: "br1234", outlet: "Bright", productKeys: ["beef", "goat"] },
    { code: "kyaloa", outlet: "Baraka A", productKeys: ["beef"] },
    { code: "kithitoa", outlet: "HQ", productKeys: ["beef", "liver"] },
  ];

  console.log("Seeding AttendantAssignment rows (upsert)...");
  for (const r of rows) {
    const code = (r.code || "").replace(/\s+/g, "").toLowerCase();
    try {
      await prisma.attendantAssignment.upsert({
        where: { code },
        create: { code, outlet: r.outlet, productKeys: r.productKeys },
        update: { outlet: r.outlet, productKeys: r.productKeys },
      });
      console.log(`✔ upserted ${code} -> ${r.outlet} [${r.productKeys.join(", ")}]`);
    } catch (e) {
      console.error(`✖ failed for ${code}`, e);
      if ((e?.code || "") === "P2021") {
        console.error("It looks like the table doesn't exist. Run: prisma migrate deploy (use direct Neon URL if pooled times out)");
      }
    }
  }
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
