// src/server/wa_links.ts
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const APP_ORIGIN = process.env.APP_ORIGIN || "https://barakafresh.com";
const TTL_MIN = Number(process.env.WA_SESSION_TTL_MIN || 10);

export async function createLoginLink(phoneE164: string) {
  const nonce = crypto.randomBytes(6).toString("hex"); // 12 chars
  const sess = await (prisma as any).waSession.findFirst({ where: { phoneE164 } });

  if (sess) {
    await (prisma as any).waSession.update({
      where: { id: sess.id },
      data: {
        state: "LOGIN",
        code: null,
        outlet: null,
        cursor: {
          ...(sess.cursor as any),
          loginNonce: nonce,
          loginNonceAt: new Date().toISOString(),
          ttlMinutes: TTL_MIN,
        } as any,
      },
    });
  } else {
    await (prisma as any).waSession.create({
      data: {
        phoneE164,
        role: null,
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

  const wa = encodeURIComponent(phoneE164);
  const q = new URLSearchParams({ wa, nonce }).toString();
  const url = `${APP_ORIGIN}/login?${q}`;
  return { url, nonce } as const;
}

export async function getLoginLinkFor(phoneE164: string) {
  const { url } = await createLoginLink(phoneE164);
  return url;
}

