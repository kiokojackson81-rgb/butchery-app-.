import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || null;
    const dbPresent = !!process.env.DATABASE_URL;
    return NextResponse.json({ ok: true, commit, dbPresent, now: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
