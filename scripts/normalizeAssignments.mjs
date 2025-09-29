// Normalize AttendantAssignment codes in-place to trim/strip spaces/lowercase
// Usage (PowerShell):
//   $env:DATABASE_URL = "<your Neon direct URL>"; node scripts/normalizeAssignments.mjs
// Assumes prisma schema has AttendantAssignment with unique code field

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function norm(s) {
  return (s || "").toString().trim().replace(/\s+/g, "").toLowerCase();
}

async function safeSelectRows() {
  try {
    // Try with productKeys + updatedAt
    return await prisma.$queryRaw`SELECT code, outlet, "productKeys", "updatedAt" FROM "AttendantAssignment"`;
  } catch {
    // Fallback minimal shape
    return await prisma.$queryRaw`SELECT code, outlet FROM "AttendantAssignment"`;
  }
}

async function rowByCode(code) {
  const rows = await prisma.$queryRaw`SELECT code, outlet, "productKeys", "updatedAt" FROM "AttendantAssignment" WHERE code = ${code}`;
  return rows?.[0] || null;
}

async function updateCode(oldCode, newCode) {
  await prisma.$executeRaw`UPDATE "AttendantAssignment" SET code = ${newCode} WHERE code = ${oldCode}`;
}

async function deleteByCode(code) {
  await prisma.$executeRaw`DELETE FROM "AttendantAssignment" WHERE code = ${code}`;
}

async function main() {
  const all = await safeSelectRows();
  let changed = 0;
  for (const row of all) {
    const src = row.code;
    const want = norm(src);
    if (!src || src === want) continue;
    const clash = await rowByCode(want);
    if (clash) {
      // Prefer most recent if updatedAt available; otherwise prefer the normalized target row
      let keep = clash;
      let drop = row;
      if (row.updatedAt && clash.updatedAt && row.updatedAt > clash.updatedAt) {
        // We want to keep current row, rename it to want and then drop the clash
        await updateCode(src, want).catch(() => {});
        await deleteByCode(clash.code).catch(() => {});
      } else {
        // Drop current row, keep clash
        await deleteByCode(src).catch(() => {});
      }
      console.log(`Merged duplicate into ${want}`);
    } else {
      await updateCode(src, want);
      console.log(`Renamed ${src} -> ${want}`);
    }
    changed++;
  }
  console.log(`Done. Changed ${changed} row(s).`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
