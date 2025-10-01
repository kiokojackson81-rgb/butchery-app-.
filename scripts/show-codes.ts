import { prisma } from "@/lib/prisma";

async function main() {
  console.log("=== PersonCodes (active) ===");
  const codes = await prisma.personCode.findMany({
    where: { active: true },
    select: { id: true, code: true, role: true, name: true, active: true },
    orderBy: { role: "asc" },
    take: 50,
  });
  for (const c of codes) {
    console.log(`${c.role.toUpperCase()} • ${c.code} • ${c.name ?? "-"} • active=${c.active}`);
  }

  console.log("\n=== PhoneMappings (linked) ===");
  const phones = await prisma.phoneMapping.findMany({
    select: { code: true, role: true, phoneE164: true, outlet: true },
    take: 50,
  });
  for (const p of phones) {
    console.log(`${p.role.toUpperCase()} • ${p.code} • ${p.phoneE164 ?? "-"} • outlet=${p.outlet ?? "-"}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
