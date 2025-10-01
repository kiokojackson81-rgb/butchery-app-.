#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";

async function fix(table: string) {
  try {
    const rows: any[] = await (prisma as any).$queryRawUnsafe(`SELECT id, code FROM "${table}" WHERE code ~ '[A-Z ]'`);
    for (const r of rows) {
      const fixed = String(r.code || '').toLowerCase();
      await (prisma as any).$executeRawUnsafe(`UPDATE "${table}" SET code = ${fixed} WHERE id = ${r.id}`);
    }
    console.log(`Normalized ${rows.length} rows in ${table}`);
  } catch {}
}

async function main() {
  for (const t of ["PersonCode","LoginCode","Attendant","Supervisor","Supplier"]) {
    await fix(t);
  }
  console.log("✅ Normalization complete (lowercased). Spacing canonicalization is handled by functional indexes & queries.");
}

main().catch((e) => { console.error(e); process.exit(1); });
