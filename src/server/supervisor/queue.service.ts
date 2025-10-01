// src/server/supervisor/queue.service.ts
import { prisma } from "@/lib/prisma";
import { ZQueueQuery } from "./supervisor.validation";

export async function listQueue(query: unknown) {
  const { status, outlet, limit, cursor } = ZQueueQuery.parse(query);

  const where: any = { status };
  if (outlet) where.outlet = outlet;

  const orderBy = [{ createdAt: "asc" as const }, { id: "asc" as const }];

  const items = await (prisma as any).reviewItem.findMany({
    where,
    orderBy,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  let nextCursor: string | null = null;
  if (items.length > limit) {
    const last = items.pop()!;
    nextCursor = last.id;
  }
  return { items, nextCursor };
}
