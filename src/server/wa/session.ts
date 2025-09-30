// src/server/wa/session.ts
import { prisma } from "@/lib/db";

export const SESSION_IDLE_MIN = 10;

export async function touchSession(sessionId: string) {
  try {
    await (prisma as any).waSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
  } catch {}
}
