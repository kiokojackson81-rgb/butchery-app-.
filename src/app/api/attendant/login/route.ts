// src/app/api/attendant/login/route.ts
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { prisma } from '@/lib/prisma';
import { createSession } from '@/lib/session';
import { canonFull, canonNum } from '@/lib/codeNormalize';

async function findAssignmentByCode(raw: string) {
  const canonical = canonFull(raw);
  if (canonical) {
    const byCanonical = await (prisma as any).attendantAssignment.findUnique({
      where: { code: canonical },
      select: { code: true, outlet: true, productKeys: true, updatedAt: true },
    });
    if (byCanonical) return byCanonical;
  }

  const digits = canonNum(raw);
  if (!digits) return null;
  const matches: any[] = await (prisma as any).$queryRaw`
    SELECT raw_code
    FROM "vw_codes_norm"
    WHERE source = 'attendant_assignment'
      AND canon_num = ${digits}
  `;
  if (!Array.isArray(matches) || matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error('ambiguous_digits');
  }
  const matchCode = matches[0]?.raw_code as string | undefined;
  if (!matchCode) return null;
  return (prisma as any).attendantAssignment.findUnique({
    where: { code: matchCode },
    select: { code: true, outlet: true, productKeys: true, updatedAt: true },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const raw = (body?.code ?? '').toString();
    const canonical = canonFull(raw);

    if (!canonical) {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 });
    }

    let row;
    try {
      row = await findAssignmentByCode(raw);
    } catch (err: any) {
      if (String(err?.message) === 'ambiguous_digits') {
        return NextResponse.json({ error: 'Ambiguous code (multiple matches)' }, { status: 409 });
      }
      throw err;
    }

    if (!row) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
    }

    // Non-breaking: also create a short-lived server session so values persist across reloads/devices
    // We bind the session to this attendant code and outlet.
    // Find or create a minimal Attendant record using this code as a unique loginCode.
    let att = await (prisma as any).attendant.findFirst({
      where: { loginCode: row.code },
    }).catch(() => null as any);
    if (!att) {
      att = await (prisma as any).attendant.create({
        data: { name: row.code, loginCode: row.code },
      }).catch(() => null as any);
    }

    if (att) {
      await createSession(att.id, row.outlet ?? undefined);
      return NextResponse.json({
        ok: true,
        code: row.code,
        outlet: row.outlet,
        productKeys: row.productKeys,
        updatedAt: row.updatedAt,
      });
    }

    // Fallback if we couldn't create an attendant (DB issue): return original response
    return NextResponse.json({
      ok: true,
      code: row.code,
      outlet: row.outlet,
      productKeys: row.productKeys,
      updatedAt: row.updatedAt,
    });
  } catch (err: any) {
    console.error('Attendant login error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
