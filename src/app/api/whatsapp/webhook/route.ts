import crypto from 'crypto';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function textResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

export async function GET(req: Request) {
  // Deprecated path — canonical webhook is /api/wa/webhook. Return 410 to avoid accidental use.
  return textResponse('Gone', 410);
}

export async function POST(req: Request) {
  // Deprecated path — canonical webhook is /api/wa/webhook. Return 410 to avoid accidental use.
  return NextResponse.json({ ok: false, error: 'Deprecated webhook path' }, { status: 410 });
}
