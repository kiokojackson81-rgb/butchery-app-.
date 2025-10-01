#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { canonNum, canonFull } from "@/lib/codeNormalize";

async function main() {
  const rows: any[] = await (prisma as any).$queryRawUnsafe(
    `SELECT a."loginCode" as code, a.name, a."outletId", o.name as outlet
     FROM "Attendant" a
     JOIN "LoginCode" l
       ON lower(regexp_replace(l.code, '\\s+', '', 'g')) = lower(regexp_replace(a."loginCode", '\\s+', '', 'g'))
      AND l."expiresAt" > now()
     LEFT JOIN "Outlet" o ON a."outletId" = o.id
     ORDER BY o.name NULLS LAST, a.name`
  );

  if (!rows.length) {
    console.log("No attendants found.");
    return;
  }

  console.log("Attendant Codes (active-ish listing):");
  for (const r of rows) {
    const raw = r.code || "";
    const full = canonFull(raw);
    const num = canonNum(raw);
    console.log(`- ${raw}  | outlet: ${r.outlet ?? "-"} | full:${full} | #:${num}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
