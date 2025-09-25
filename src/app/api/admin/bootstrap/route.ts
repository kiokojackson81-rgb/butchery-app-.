import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  // outlets/products/codes
  const [outlets, products, codes, scopes, pbRows] = await Promise.all([
    prisma.outlet.findMany({ orderBy: { name: "asc" } }),
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    prisma.personCode.findMany({ orderBy: { name: "asc" } }),
    prisma.attendantScope.findMany({ include: { products: true } }),
    prisma.pricebookRow.findMany(),
  ]);

  // scope map: codeNorm -> { outlet, productKeys[] }
  const scope: Record<string, { outlet: string; productKeys: string[] }> = {};
  for (const s of scopes) scope[s.codeNorm] = { outlet: s.outletName, productKeys: s.products.map(p => p.productKey) };

  // pricebook: outletName -> productKey -> { sellPrice, active }
  const pricebook: Record<string, Record<string, { sellPrice: number; active: boolean }>> = {};
  for (const row of pbRows) {
    pricebook[row.outletName] ||= {};
    pricebook[row.outletName][row.productKey] = { sellPrice: row.sellPrice, active: row.active };
  }

  return NextResponse.json({
    outlets,
    products,
    codes,
    scope,
    pricebook,
  });
}
