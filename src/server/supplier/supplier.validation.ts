// src/server/supplier/supplier.validation.ts
import { z } from "zod";

export const ZDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const ZOutlet = z.string().min(1);
export const ZItemKey = z.string().min(1);
export const ZQty = z.number().nonnegative();
export const ZPrice = z.number().min(0);
export const ZUnit = z.enum(["kg", "pcs"]);

export const ZOpeningRowInput = z.object({
  date: ZDate,
  outlet: ZOutlet,
  itemKey: ZItemKey,
  qty: ZQty,
  buyPrice: ZPrice.optional(),
  unit: ZUnit,
});

export const ZLockDayInput = z.object({
  date: ZDate,
  outlet: ZOutlet,
});

export const ZTransferInput = z.object({
  date: ZDate,
  fromOutlet: ZOutlet,
  toOutlet: ZOutlet,
  itemKey: ZItemKey,
  qty: ZQty,
  unit: ZUnit,
  note: z.string().max(200).optional(),
});

export const ZDisputeInput = z.object({
  date: ZDate,
  outlet: ZOutlet,
  itemKey: ZItemKey,
  qty: ZQty,
  reason: z.string().min(3).max(300),
  evidenceUrls: z.array(z.string().url()).optional(),
});

export const ZRequestEditInput = z.object({
  date: ZDate,
  outlet: ZOutlet,
  rows: z
    .array(
      z.object({
        itemKey: ZItemKey,
        qty: ZQty.optional(),
        buyPrice: ZPrice.optional(),
      })
    )
    .min(1),
  reason: z.string().min(3).max(300),
});
