import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { destroySession, serializeClearSessionCookie } from "@/lib/session";
import { serializeClearRoleCookie } from "@/lib/roleSession";

export async function POST() {
  try {
    await destroySession();
    const res = NextResponse.json({ ok: true });
    // Explicitly clear the cookie on the client
  res.headers.set("Set-Cookie", serializeClearSessionCookie());
  res.headers.append("Set-Cookie", serializeClearRoleCookie());
    return res;
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
