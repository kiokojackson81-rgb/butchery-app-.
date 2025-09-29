// src/app/api/attendant/login/route.ts
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { prisma } from '@/lib/prisma';
import { createSession, serializeSessionCookie } from '@/lib/session';
import { resolveAssignment } from '@/lib/resolveAssignment';
import { normalizeCode } from '@/lib/normalizeCode';

export async function POST(req: Request) {
  try {
  const body = await req.json().catch(() => ({}));
  const codeRaw = (body?.code ?? '').toString();
  const code = normalizeCode(codeRaw);

    if (!code) {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 });
    }

    const resolved = await resolveAssignment(code);
    if (!resolved) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
    }

    // Non-breaking: also create a short-lived server session so values persist across reloads/devices
    // We bind the session to this attendant code and outlet.
    // Find or create a minimal Attendant record using this code as a unique loginCode.
    let att = await (prisma as any).attendant.findFirst({ where: { loginCode: code } }).catch(() => null as any);
    if (!att) {
      // Row.code is already normalized (from AttendantAssignment). Persist normalized for consistency.
      att = await (prisma as any).attendant.create({ data: { name: code, loginCode: code } }).catch(() => null as any);
    }
    if (att) {
      const { token, expiresAt } = await createSession(att.id, resolved.outlet ?? undefined);
      // Also attach cookie explicitly on the response to avoid any proxy nuances
      const res = NextResponse.json(
        {
          ok: true,
          code,
          outlet: resolved.outlet,
          productKeys: resolved.productKeys,
          updatedAt: expiresAt,
        },
        { status: 200 }
      );
      try {
        // Set cookie via both helpers to maximize compatibility across runtimes/proxies
        res.cookies.set({
          name: "bk_sess",
          value: token,
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 24 * 3600,
        });
        res.headers.append("Set-Cookie", serializeSessionCookie(token));
      } catch {}
      return res;
    }

    // Fallback if we couldn't create an attendant (DB issue): return original response
    const res = NextResponse.json(
      {
        ok: true,
        code,
        outlet: resolved.outlet,
        productKeys: resolved.productKeys,
        updatedAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      },
      { status: 200 }
    );
    try {
      // Best-effort cookie set if DB write path above failed but we still want client to proceed
      res.cookies.set({
        name: "bk_sess",
        value: "",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 24 * 3600,
      });
    } catch {}
    return res;
  } catch (err: any) {
    console.error('Attendant login error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
