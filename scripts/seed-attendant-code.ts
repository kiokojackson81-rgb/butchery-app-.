// scripts/seed-attendant-code.ts
// Minimal helper to insert a sample attendant code if none exist.
import { prisma } from "@/lib/db";

async function main() {
  const existing = await (prisma as any).personCode.findFirst({ where: { role: "attendant", active: true } });
  if (existing) {
    console.log("An active attendant code already exists:", existing.code);
    return;
  }
  const code = "BR1234";
  const row = await (prisma as any).personCode.create({ data: { code, role: "attendant", name: "Sample Attendant", active: true } });
  console.log("Seeded attendant code:", row.code);

  // Also create a scope row placeholder if absent
  const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: code } });
  if (!scope) {
    await (prisma as any).attendantScope.create({ data: { codeNorm: code, outletName: "Demo Outlet" } });
    console.log("Created attendant scope for", code, "@ Demo Outlet");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await (prisma as any).$disconnect(); });
