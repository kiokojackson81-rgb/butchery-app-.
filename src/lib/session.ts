import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "bk_sess";
const SESSION_TTL_HOURS = 24;

export async function createSession(attendantId: string, outletCode?: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);

  await (prisma as any).session.create({
    data: { attendantId, token, outletCode, expiresAt },
  });

  // Set cookie here to centralize attributes and avoid duplication in routes
  const maxAge = SESSION_TTL_HOURS * 3600;
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

export function serializeSessionCookie(token: string, maxAgeSeconds = SESSION_TTL_HOURS * 3600) {
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
  const sess = await (prisma as any).session.findUnique({
    where: { token },
    include: { attendant: { include: { outletRef: true } } },
  });
  if (!sess || sess.expiresAt < new Date()) return null;
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
