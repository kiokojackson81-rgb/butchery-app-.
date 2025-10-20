#!/usr/bin/env node
import { prisma } from '../src/lib/prisma.js';

// Usage:
//   node scripts/seed-phone-mapping.mjs +254705663175 supervisor Kawangware SUPV001 "Supervisor Name"
//   node scripts/seed-phone-mapping.mjs +254705663175 attendant Kawangware ATT001 "Attendant Name"

const [,, phoneArg, roleArg, outletArg, codeArg, nameArg] = process.argv;

if (!phoneArg || !roleArg) {
  console.error('Usage: node scripts/seed-phone-mapping.mjs +2547XXXX role [outlet] [code] [name]');
  process.exit(1);
}

const phone = phoneArg.startsWith('+') ? phoneArg : '+' + phoneArg;
const role = String(roleArg).toLowerCase();
const outlet = outletArg || null;
const code = codeArg || null;
const name = nameArg || null;

async function main() {
  // Optional: ensure PersonCode for better name resolution in notifications
  if (code) {
    try {
      await prisma.personCode.upsert({
        where: { code },
        update: { name: name || undefined, role: role === 'attendant' ? 'attendant' : role === 'supplier' ? 'supplier' : 'supervisor', active: true },
        create: { code, name: name || null, role: role === 'attendant' ? 'attendant' : role === 'supplier' ? 'supplier' : 'supervisor', active: true },
      });
      console.log('Upserted PersonCode:', code);
    } catch (e) {
      console.warn('PersonCode upsert failed (continuing):', String(e.message || e));
    }
  }

  // Upsert PhoneMapping
  try {
    if (code) {
      await prisma.phoneMapping.upsert({
        where: { code },
        update: { phoneE164: phone, role, outlet: outlet || undefined },
        create: { code, phoneE164: phone, role, outlet: outlet || undefined },
      });
      console.log('Upserted PhoneMapping for code:', code);
    } else {
      // If no code was provided, create a unique code from phone/role
      const generated = `${role}-${phone.replace(/[^0-9]/g, '')}`;
      await prisma.phoneMapping.create({ data: { code: generated, phoneE164: phone, role, outlet: outlet || undefined } });
      console.log('Created PhoneMapping code:', generated);
    }
  } catch (e) {
    console.error('PhoneMapping upsert failed:', String(e.message || e));
    process.exit(2);
  }

  console.log('Done.');
}

main().then(()=>process.exit(0)).catch(e=>{console.error(e); process.exit(2)});
