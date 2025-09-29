// Seed minimal admin_codes setting so supervisor/supplier logins pass
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const codes = [
    { name: "Sup One", code: "sup123", role: "supervisor", active: true },
    { name: "Supp One", code: "supp123", role: "supplier", active: true },
  ];
  await prisma.setting.upsert({
    where: { key: "admin_codes" },
    update: { value: codes },
    create: { key: "admin_codes", value: codes },
  });
  console.log("Seeded admin_codes with:", codes);
}

main().finally(async () => { await prisma.$disconnect(); });
