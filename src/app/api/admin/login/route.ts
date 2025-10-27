import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "bk_admin";
const TTL_SECONDS = 24 * 60 * 60;

function serializeCookie(token: string | null, maxAgeSeconds = TTL_SECONDS) {
  const secure = process.env.NODE_ENV === "production";
  if (!token) {
    return [
      `${COOKIE_NAME}=; Path=/`,
      "HttpOnly",
      "SameSite=Lax",
      ...(secure ? ["Secure"] : []),
      "Max-Age=0",
    ].join("; ");
  }
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

// For development convenience there are legacy defaults. In production please
// set ADMIN_EMAIL and ADMIN_PASSWORD in the environment (or a secret store).
const DEV_ADMIN_EMAIL = "kiokojackson81@gmail.com";
const DEV_ADMIN_PASSWORD = "Ads0k015@#";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String((body?.email ?? "")).trim().toLowerCase();
    const password = String(body?.password ?? "");

    const expectedEmail = (process.env.ADMIN_EMAIL || DEV_ADMIN_EMAIL).trim().toLowerCase();
    const expectedPass = process.env.ADMIN_PASSWORD || DEV_ADMIN_PASSWORD;

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Missing credentials" }, { status: 400 });
    }

    if (email !== expectedEmail || password !== expectedPass) {
      return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
    }

    // credentials are valid — create a server-side admin session (cookie + AppState)
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
    const payload = { token, expiresAt, createdBy: "login" };

    let upsertOk = true;
    try {
      await (prisma as any).appState.upsert({
        where: { key: "admin_session" },
        update: { value: payload },
        create: { key: "admin_session", value: payload },
      });
    } catch (err: any) {
      console.error("AppState upsert failed during login (fallback):", String(err?.message ?? err));
      upsertOk = false;
    }

    const res = NextResponse.json({ ok: true });
    res.headers.append("Set-Cookie", serializeCookie(token));
    const body: any = { ok: true };
    if (!upsertOk) body.warning = "appstate_unavailable";
    return NextResponse.json(body, { status: 200, headers: res.headers });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
