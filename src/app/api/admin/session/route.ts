import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

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

export async function POST(req: Request) {
  try {
    // Create a simple admin session token and persist to AppState so StorageBridge
    // and other servers can inspect it if needed. We don't require extra credentials
    // here because admin credentials are validated client-side for this app.
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
    const payload = { token, expiresAt, createdBy: "client" };
    await (prisma as any).appState.upsert({
      where: { key: "admin_session" },
      update: { value: payload },
      create: { key: "admin_session", value: payload },
    });

    const res = NextResponse.json({ ok: true });
    res.headers.append("Set-Cookie", serializeCookie(token));
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function GET() {
  try {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
    if (!token) return NextResponse.json({ ok: false }, { status: 401 });
    const row = await (prisma as any).appState.findUnique({ where: { key: "admin_session" } });
    if (!row || !row.value) return NextResponse.json({ ok: false }, { status: 401 });
    const val = row.value as any;
    if (val?.token !== token) return NextResponse.json({ ok: false }, { status: 401 });
    if (val?.expiresAt && new Date(val.expiresAt) < new Date()) return NextResponse.json({ ok: false }, { status: 401 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    // Clear the server-side admin session and expire cookie
    await (prisma as any).appState.upsert({
      where: { key: "admin_session" },
      update: { value: null },
      create: { key: "admin_session", value: null },
    });
    const res = NextResponse.json({ ok: true });
    res.headers.append("Set-Cookie", serializeCookie(null));
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

