// src/server/review.ts
import { prisma } from "@/lib/db";

export async function createReviewItem(args: { type: string; outlet: string; date: Date; payload: any }) {
  await (prisma as any).reviewItem.create({ data: { type: args.type, outlet: args.outlet, date: args.date, payload: args.payload, status: "pending" } });
}
