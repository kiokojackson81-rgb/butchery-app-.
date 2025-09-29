// Normalize AttendantAssignment codes in-place to trim/strip spaces/lowercase
// Usage (PowerShell):
//   $env:DATABASE_URL = "<your Neon direct URL>"; node scripts/normalizeAssignments.mjs
// Assumes prisma schema has AttendantAssignment with unique code field

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function norm(s) {
  return (s || "").toString().trim().replace(/\s+/g, "").toLowerCase();
}

async function main() {
  const all = await prisma.attendantAssignment.findMany();
  let changed = 0;
  for (const row of all) {
    const want = norm(row.code);
    if (row.code !== want) {
      // Handle potential conflict: if another row already exists with normalized code, merge then delete duplicate
      const clash = await prisma.attendantAssignment.findUnique({ where: { code: want } }).catch(() => null);
      if (clash) {
        // Merge: prefer keeping productKeys/outlet from the most recently updated
        const keep = row.updatedAt > clash.updatedAt ? row : clash;
        const drop = keep.id === row.id ? clash : row;
        await prisma.attendantAssignment.update({ where: { id: keep.id }, data: { code: want, outlet: keep.outlet, productKeys: keep.productKeys } });
        await prisma.attendantAssignment.delete({ where: { id: drop.id } });
        console.log(`Merged duplicate codes into ${want}`);
      } else {
        await prisma.attendantAssignment.update({ where: { id: row.id }, data: { code: want } });
        console.log(`Renamed ${row.code} -> ${want}`);
      }
      changed++;
    }
  }
  console.log(`Done. Changed ${changed} row(s).`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
