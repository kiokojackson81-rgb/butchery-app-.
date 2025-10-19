#!/usr/bin/env tsx
import { PrismaClient, PersonRole } from '@prisma/client';

const prisma = new PrismaClient();

// Usage examples:
//   tsx scripts/seed-phone-mapping.ts +254705663175 supervisor Kawangware SUPV001 "Supervisor Name"
//   tsx scripts/seed-phone-mapping.ts +254705663175 attendant Kawangware ATT001 "Attendant Name"

const [,, phoneArg, roleArg, outletArg, codeArg, nameArg] = process.argv;

if (!phoneArg || !roleArg) {
  console.error('Usage: tsx scripts/seed-phone-mapping.ts +2547XXXX role [outlet] [code] [name]');
  process.exit(1);
}

const phone = phoneArg.startsWith('+') ? phoneArg : '+' + phoneArg;
const role = String(roleArg).toLowerCase();
const outlet = outletArg || null;
const code = codeArg || null;
const name = nameArg || null;

function toPersonRole(r: string): PersonRole {
  if (r === 'attendant') return 'attendant';
  if (r === 'supplier') return 'supplier';
  return 'supervisor';
}

async function main() {
  if (code) {
    try {
      await prisma.personCode.upsert({
        where: { code },
        update: { name: name || undefined, role: toPersonRole(role), active: true },
        create: { code, name: name || null, role: toPersonRole(role), active: true },
      });
      console.log('Upserted PersonCode:', code);
    } catch (e: any) {
      console.warn('PersonCode upsert failed (continuing):', String(e?.message || e));
    }
  }

  try {
    if (code) {
      await prisma.phoneMapping.upsert({
        where: { code },
        update: { phoneE164: phone, role, outlet: outlet || undefined },
        create: { code, phoneE164: phone, role, outlet: outlet || undefined },
      });
      console.log('Upserted PhoneMapping for code:', code);
    } else {
      const generated = `${role}-${phone.replace(/[^0-9]/g, '')}`;
      await prisma.phoneMapping.create({ data: { code: generated, phoneE164: phone, role, outlet: outlet || undefined } });
      console.log('Created PhoneMapping code:', generated);
    }
  } catch (e: any) {
    console.error('PhoneMapping upsert failed:', String(e?.message || e));
    process.exit(2);
  }
  console.log('Done.');
}

main().then(()=>prisma.$disconnect()).catch(e=>{console.error(e); prisma.$disconnect().finally(()=>process.exit(2));});
