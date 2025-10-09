// src/server/wa_links.ts
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const APP_ORIGIN = process.env.APP_ORIGIN || "https://barakafresh.com";
const TTL_MIN = Number(process.env.WA_SESSION_TTL_MIN || 120);

export async function createLoginLink(phoneE164: string) {
  const nonce = crypto.randomBytes(6).toString("hex"); // 12 chars
  const sess = await (prisma as any).waSession.findFirst({ where: { phoneE164 } });

  if (sess) {
    // If there's already an active MENU session with credentials, avoid flipping it back
    // to LOGIN (this was causing login loops where the portal finalized then the
    // webhook created a login link which clobbered the MENU state). Instead, write
    // the loginNonce into the cursor while preserving code/outlet/state for active
    // sessions. For sessions that are not in MENU or lack credentials, fall back to
    // the previous behaviour and move them to LOGIN state.
    const cursorUpdate: any = {
      ...(sess.cursor as any),
      loginNonce: nonce,
      loginNonceAt: new Date().toISOString(),
      ttlMinutes: TTL_MIN,
    };
    const updateData: any = { cursor: cursorUpdate };
    if (!(sess.state === "MENU" && sess.code)) {
      // preserve previous behaviour for non-MENU or unauthenticated sessions
      updateData.state = "LOGIN";
      updateData.code = null;
      updateData.outlet = null;
    }
    await (prisma as any).waSession.update({ where: { id: sess.id }, data: updateData });
  } else {
    await (prisma as any).waSession.create({
      data: {
        phoneE164,
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

  // Avoid double-encoding by letting URLSearchParams handle encoding once
  const q = new URLSearchParams({ wa: phoneE164, nonce }).toString();
  const url = `${APP_ORIGIN}/login?${q}`;
  return { url, nonce } as const;
}

export async function getLoginLinkFor(phoneE164: string) {
  const { url } = await createLoginLink(phoneE164);
  return url;
}

