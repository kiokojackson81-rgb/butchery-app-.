// src/server/wa_sessions.ts
import type { WaSession } from "@prisma/client";

const TTL_MIN = parseInt(process.env.WA_SESSION_TTL_MIN || "10");

export function expired(sess: Pick<WaSession, "updatedAt">) {
  try {
    return Date.now() - new Date(sess.updatedAt).getTime() > TTL_MIN * 60 * 1000;
  } catch {
    return true;
  }
}
