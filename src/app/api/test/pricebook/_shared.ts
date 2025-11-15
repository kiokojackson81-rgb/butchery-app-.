// Shared helpers for test pricebook upserts
import type { PrismaClient } from "@prisma/client";

export async function loadPrisma(): Promise<PrismaClient> {
  const mod = await import("@/lib/prisma");
  const prisma: any = (mod as any).prisma;
  if (!prisma) throw new Error("prisma_export_missing");
  return prisma as PrismaClient;
}

export async function upsertPricebookRow(prisma: any, params: { outletName: string; productKey: string; sellPrice: number; active?: boolean }) {
  const outletName = String(params.outletName || "").trim();
  const productKey = String(params.productKey || "").trim();
  const sellPrice = Number(params.sellPrice ?? 0);
  const active = typeof params.active === "boolean" ? params.active : true;
  if (!outletName || !productKey || !Number.isFinite(sellPrice)) {
    throw new Error("outletName/productKey/sellPrice required");
  }
  return prisma.pricebookRow.upsert({
    where: { outletName_productKey: { outletName, productKey } },
    create: { outletName, productKey, sellPrice, active },
    update: { sellPrice, active },
  });
}
