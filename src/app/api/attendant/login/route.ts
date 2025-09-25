// src/app/api/attendant/login/route.ts
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { prisma } from '@/lib/prisma';

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
