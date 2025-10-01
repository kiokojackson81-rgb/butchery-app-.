#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { canonFull } from "@/lib/codeNormalize";

async function main() {
  const name   = process.env.SEED_NAME   || "Bright Attendant";
  const codeIn = process.env.SEED_CODE   || "BR 12345";
  const outlet = process.env.SEED_OUTLET || "Bright";

  const code = canonFull(codeIn);

  // Outlet by name
  const out = await (prisma as any).outlet.upsert({
    where: { name: outlet },
    update: { active: true },
    create: { name: outlet, code: canonFull(outlet), active: true },
  });

  // PersonCode
  try {
    await (prisma as any).personCode.upsert({
      where: { code },
      update: { name, role: "attendant", active: true },
      create: { code, name, role: "attendant", active: true },
    });
  } catch {}

  // Attendant (maps loginCode -> outlet via outletId in current schema)
  try {
    const existing = await (prisma as any).attendant.findFirst({ where: { loginCode: { equals: code, mode: 'insensitive' } } });
    if (existing) {
      await (prisma as any).attendant.update({ where: { id: existing.id }, data: { name, outletId: out.id } });
    } else {
      await (prisma as any).attendant.create({ data: { name, loginCode: code, outletId: out.id } });
    }
  } catch {}

  // LoginCode (auth surface; tie to the attendant row created/updated)
  try {
    const att = await (prisma as any).attendant.findFirst({ where: { loginCode: { equals: code, mode: 'insensitive' } } });
    if (att) {
      await (prisma as any).loginCode.upsert({
        where: { code },
        update: { attendantId: att.id, expiresAt: new Date(Date.now() + 7*24*3600*1000) },
        create: { code, attendantId: att.id, expiresAt: new Date(Date.now() + 7*24*3600*1000) },
      });
    }
  } catch {}

  // Optional mirror update (Admin cache)
  try {
    const key = "admin_codes";
    const current = await (prisma as any).setting.findUnique({ where: { key } });
    const list = Array.isArray((current as any)?.value) ? (current as any).value as any[] : [];
    const idx = list.findIndex((p: any) => canonFull(p?.code || "") === code);
    const person = { name, code, role: "attendant", active: true, outlet };
    if (idx >= 0) list[idx] = { ...list[idx], ...person };
    else list.push(person);
    await (prisma as any).setting.upsert({ where: { key }, update: { value: list }, create: { key, value: list } });
  } catch {}

  console.log(`[seed] Seeded attendant:\n  - Name:   ${name}\n  - Code:   ${codeIn}  (stored as: ${code})\n  - Outlet: ${outlet}\n  You can log in using: "${codeIn}", "BR12345", "br 12345", or just "12345" (if unique).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
