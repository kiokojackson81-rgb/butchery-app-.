// src/app/api/attendant/login/route.ts
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { prisma } from '@/lib/prisma';
import { createSession, serializeSessionCookie } from '@/lib/session';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const codeRaw = (body?.code ?? '').toString();

    // normalize like your UI does (trim)
    const code = codeRaw.trim();

    if (!code) {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 });
    }

    const row = await (prisma as any).attendantAssignment.findUnique({
      where: { code },
      select: { code: true, outlet: true, productKeys: true, updatedAt: true },
    });

    if (!row) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
    }

    // Non-breaking: also create a short-lived server session so values persist across reloads/devices
    // We bind the session to this attendant code and outlet.
    // Find or create a minimal Attendant record using this code as a unique loginCode.
    let att = await (prisma as any).attendant.findFirst({ where: { loginCode: row.code } }).catch(() => null as any);
    if (!att) {
      att = await (prisma as any).attendant.create({ data: { name: row.code, loginCode: row.code } }).catch(() => null as any);
    }
    if (att) {
      const { token } = await createSession(att.id, row.outlet ?? undefined);
      const res = NextResponse.json(
        {
          ok: true,
          code: row.code,
          outlet: row.outlet,
          productKeys: row.productKeys,
          updatedAt: row.updatedAt,
        },
        { status: 200 }
      );
      res.headers.append('Set-Cookie', serializeSessionCookie(token));
      return res;
    }

    // Fallback if we couldn't create an attendant (DB issue): return original response
    return NextResponse.json(
      {
        ok: true,
        code: row.code,
        outlet: row.outlet,
        productKeys: row.productKeys,
        updatedAt: row.updatedAt,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('Attendant login error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
