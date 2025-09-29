// Upsert AttendantAssignment for BR1234 -> Bright with specific product keys
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const raw = "BR1234";
  const code = raw.replace(/\s+/g, "").toLowerCase();
  const outlet = "Bright";
  const productKeys = ["beef"]; // adjust if needed

  await prisma.attendantAssignment.upsert({
    where: { code },
    create: { code, outlet, productKeys },
    update: { outlet, productKeys },
  });
  console.log(`✔ upserted ${code} -> ${outlet} [${productKeys.join(", ")}]`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
