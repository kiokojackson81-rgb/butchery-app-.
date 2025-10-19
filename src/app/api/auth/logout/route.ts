import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { destroySession, serializeClearSessionCookie } from "@/lib/session";
import { serializeClearRoleCookie } from "@/lib/roleSession";

export async function POST() {
  try {
    // Remove server-side session row (best-effort)
    await destroySession().catch(() => {});

    const res = NextResponse.json({ ok: true });
    // Clear cookies explicitly to avoid stale identities
    res.headers.append("Set-Cookie", serializeClearSessionCookie());
    res.headers.append("Set-Cookie", serializeClearRoleCookie());
    return res;
  } catch (err: any) {
    const msg = typeof err?.message === "string" ? err.message : "logout failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  // Allow idempotent logout via GET as well (useful for simple links)
  return POST();
}
 
