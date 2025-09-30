// scripts/show-attendant-codes.ts
import { prisma } from "@/lib/db";

async function main() {
  console.log("=== Active ATTENDANT codes ===");

  // Active PersonCodes for attendants
  const codes = await (prisma as any).personCode.findMany({
    where: { role: "attendant", active: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, active: true },
    take: 50,
  });

  if (codes.length === 0) {
    console.log("No active attendant codes found.");
    console.log("Hint: run `npx tsx scripts/seed-attendant-code.ts` to add a sample.");
    return;
  }

  for (const c of codes) {
    // Find any phone mapping
    const pm = await (prisma as any).phoneMapping.findFirst({
      where: { code: c.code, role: "attendant" },
      select: { phoneE164: true, outlet: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });

    // Try to resolve scope (outlet + products) if present
    const scope = await (prisma as any).attendantScope.findFirst({
      where: { codeNorm: c.code },
      select: {
        outletName: true,
        products: { select: { productKey: true } },
      },
    });

    const outlet = pm?.outlet ?? scope?.outletName ?? "-";
    const products = ((scope?.products as any[]) || []).map((p: any) => p.productKey).join(", ") || "-";

    console.log([
      `CODE: ${c.code}`,
      `Name: ${c.name ?? "-"}`,
      `Active: ${c.active ? "yes" : "no"}`,
      `Phone: ${pm?.phoneE164 ?? "-"}`,
      `Outlet: ${outlet}`,
      `Products: ${products}`,
    ].join(" | "));
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await (prisma as any).$disconnect(); });
