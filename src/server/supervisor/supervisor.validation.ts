// src/server/supervisor/supervisor.validation.ts
import { z } from "zod";

export const ZId = z.string().min(1);
export const ZDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const ZOutlet = z.string().min(1);
export const ZStatus = z.enum(["pending", "approved", "rejected"]);
export const ZAction = z.enum(["approve", "reject"]);

export const ZQueueQuery = z.object({
  status: ZStatus.default("pending"),
  outlet: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().optional(),
});

export const ZReviewAction = z.object({
  id: ZId,
  action: ZAction,
  note: z.string().max(500).optional(),
});

export const ZSummaryQuery = z.object({
  date: ZDate,
  outlet: ZOutlet,
});

export const ZRules = z.object({
  wastePctMax: z.number().min(0).max(100).default(5),
  expenseDailyMax: z.number().min(0).default(5000),
  depositTolerance: z.number().min(0).default(50),
});

export const ZRulesUpdate = ZRules.partial();
