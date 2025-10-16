// src/server/wa_links.ts
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const APP_ORIGIN = process.env.APP_ORIGIN || "https://barakafresh.com";
const TTL_MIN = Number(process.env.WA_SESSION_TTL_MIN || 120);

export async function createLoginLink(phoneE164: string) {
  const nonce = crypto.randomBytes(6).toString("hex"); // 12 chars
  // Normalize phone to E.164 with leading + for safety
  const e164 = phoneE164.startsWith("+") ? phoneE164 : "+" + String(phoneE164 || "").replace(/[^0-9+]/g, "");
  // Best-effort DB write; in dry-run or when DB is unavailable we proceed without throwing
  let dbOk = true;
  try {
    const sess = await (prisma as any).waSession.findFirst({ where: { phoneE164: e164 } });

    if (sess) {
      // If there's already an active MENU session with credentials, avoid flipping it back
      // to LOGIN (this was causing login loops). Instead, write loginNonce while preserving
      // code/outlet/state for active sessions. For non-MENU or unauthenticated sessions,
      // move them to LOGIN state as before.
      const cursorUpdate: any = {
        ...(sess.cursor as any),
        loginNonce: nonce,
        loginNonceAt: new Date().toISOString(),
        ttlMinutes: TTL_MIN,
      };
      const updateData: any = { cursor: cursorUpdate };
      if (!(sess.state === "MENU" && sess.code)) {
        updateData.state = "LOGIN";
        updateData.code = null;
        updateData.outlet = null;
      }
      await (prisma as any).waSession.update({ where: { id: sess.id }, data: updateData });
    } else {
      await (prisma as any).waSession.create({
        data: {
          phoneE164: e164,
          role: "attendant",
          code: null,
          outlet: null,
          state: "LOGIN",
          cursor: {
            loginNonce: nonce,
            loginNonceAt: new Date().toISOString(),
            ttlMinutes: TTL_MIN,
          } as any,
        },
      });
    }
  } catch (err: any) {
    // When DATABASE_URL is not configured or Postgres is down, allow dev flows to proceed.
    // Tests only need a deep link; the record will be created later when DB is available.
    try { console.warn?.("[wa_links] createLoginLink DB skipped", String(err?.message || err)); } catch {}
    dbOk = false;
  }

  // Avoid double-encoding by letting URLSearchParams handle encoding once
  const q = new URLSearchParams({ wa: e164, nonce }).toString();
  const url = `${APP_ORIGIN}/login?${q}`;
  // Include a hint that DB was skipped to aid diagnostics (non-breaking)
  return { url, nonce, db: dbOk ? "ok" : "skipped" } as const;
}

export async function getLoginLinkFor(phoneE164: string) {
  const { url } = await createLoginLink(phoneE164);
  return url;
}

