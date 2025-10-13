// scripts/seed-analytics.ts
import { prisma } from "@/lib/prisma";

async function main() {
  const outlets = await (prisma as any).outlet.findMany({ select: { name: true } });
  const targetRows = (outlets || []).map((o: any) => ({
    outletName: o.name,
    gpTargetDay: 0,
    npTargetDay: 0,
    wastePctMax: 0.08,
    depositRatio: 1.0,
  }));
  for (const t of targetRows) {
    await (prisma as any).outletTargets.upsert({
      where: { outletName: t.outletName },
      update: t,
      create: t,
    });
  }

  // Potatoes rule: 0.75 yield and 130 multiplier
  await (prisma as any).productDepositRule.upsert({
    where: { productKey: "potatoes" },
    update: { ratio: 0.75, multiplier: 130 },
    create: { productKey: "potatoes", ratio: 0.75, multiplier: 130 },
  });

  console.log("Seeded analytics targets and potatoes rule");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
