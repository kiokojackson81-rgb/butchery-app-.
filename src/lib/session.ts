import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "bk_sess";
// Short TTL with sliding renewal
const SESSION_TTL_SECONDS = 10 * 60; // 10 minutes

export async function createSession(attendantId: string, outletCode?: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await (prisma as any).session.create({
    data: { attendantId, token, outletCode, expiresAt },
  });

  // Set cookie here to centralize attributes and avoid duplication in routes
  const maxAge = SESSION_TTL_SECONDS;
  const jar = (await cookies()) as any;
  jar.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });

  return { token, expiresAt };
}

export function serializeSessionCookie(token: string, maxAgeSeconds = SESSION_TTL_SECONDS) {
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join("; ");
}

export async function getSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  // Select minimal fields to remain compatible with older DBs that may
  // not yet have all new Attendant columns. Avoid include:* which selects all.
  const sess = await (prisma as any).session.findUnique({
    where: { token },
    select: {
      id: true,
      attendantId: true,
      outletCode: true,
      expiresAt: true,
      createdAt: true,
      attendant: {
        select: {
          id: true,
          name: true,
          loginCode: true,
          outletRef: {
            select: { id: true, name: true, code: true },
          },
        },
      },
    },
  });
  if (!sess || sess.expiresAt < new Date()) return null;
  // Sliding renewal when less than half TTL remains
  const now = Date.now();
  const remainingMs = new Date(sess.expiresAt).getTime() - now;
  if (remainingMs < (SESSION_TTL_SECONDS * 1000) / 2) {
    const newExpiry = new Date(now + SESSION_TTL_SECONDS * 1000);
    await (prisma as any).session.update({ where: { token }, data: { expiresAt: newExpiry } }).catch(() => {});
    (jar as any).set({
      name: COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return { ...sess, expiresAt: newExpiry };
  }
  return sess;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) {
    await (prisma as any).session.delete({ where: { token } }).catch(() => {});
  }
}

export function serializeClearSessionCookie() {
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=; Path=/` ,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    "Max-Age=0",
  ];
  return parts.join("; ");
}
