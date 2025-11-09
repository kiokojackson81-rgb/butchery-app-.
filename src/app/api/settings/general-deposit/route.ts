import { NextResponse } from 'next/server';
import { isGeneralDepositAttendant, getGeneralDepositList } from '@/server/general_deposit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = (searchParams.get('code') || '').trim();
    const listParam = searchParams.get('list');
    if (listParam) {
      const list = await getGeneralDepositList();
      return NextResponse.json({ ok: true, list });
    }
    const isGeneralDeposit = await isGeneralDepositAttendant(code);
    return NextResponse.json({ ok: true, code, isGeneralDeposit });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || 'internal error') }, { status: 500 });
  }
}
