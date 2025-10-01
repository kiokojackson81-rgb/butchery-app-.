// src/server/closings.ts
import { prisma } from "@/lib/prisma";

export async function saveClosings(args: {
  date: string;
  outletName: string;
  rows: Array<{ productKey: string; closingQty: number; wasteQty: number }>;
}): Promise<void> {
  const { date, outletName, rows } = args;
  await (prisma as any).$transaction(async (tx: any) => {
    for (const r of rows) {
      const { productKey: itemKey, closingQty, wasteQty } = r;
      await tx.attendantClosing.upsert({
        where: { date_outletName_itemKey: { date, outletName, itemKey } },
        create: { date, outletName, itemKey, closingQty, wasteQty },
        update: { closingQty, wasteQty },
      });
    }
  });
}
