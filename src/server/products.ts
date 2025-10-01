// src/server/products.ts
import { prisma } from "@/lib/prisma";

export async function getAssignedProducts(code: string): Promise<Array<{ key: string; name: string }>> {
  const codeNorm = String(code || "");
  if (!codeNorm) {
    const all = await (prisma as any).product.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    return (all || []).map((p: any) => ({ key: p.key, name: p.name }));
  }

  const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm }, include: { products: true } });
  if (!scope) {
    const all = await (prisma as any).product.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    return (all || []).map((p: any) => ({ key: p.key, name: p.name }));
  }

  const productKeys: string[] = (scope.products || []).map((sp: any) => sp.productKey);
  if (!productKeys.length) return [];
  const prods = await (prisma as any).product.findMany({ where: { key: { in: productKeys }, active: true } });
  const map = new Map(prods.map((p: any) => [p.key, p] as const));
  return productKeys
    .map((k) => ({ key: k, name: (map.get(k) as any)?.name || k }))
    .filter(Boolean);
}
