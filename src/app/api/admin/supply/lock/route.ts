import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const date = typeof body?.date === 'string' ? body.date : '';
    const outlet = typeof body?.outlet === 'string' ? body.outlet : '';
    const lock = body?.lock === true;
    if (!date || !outlet) return NextResponse.json({ ok: false, error: 'date and outlet required' }, { status: 400 });

    const key = `opening_lock:${date}:${outlet}`;
    if (lock) {
      await (prisma as any).setting.upsert({
        where: { key },
        update: { value: { locked: true, outlet, date } },
        create: { key, value: { locked: true, outlet, date } },
      });
      return NextResponse.json({ ok: true, locked: true });
    } else {
      try { await (prisma as any).setting.delete({ where: { key } }); } catch {};
      return NextResponse.json({ ok: true, locked: false });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const date = String(url.searchParams.get('date') || '');
    const outlet = String(url.searchParams.get('outlet') || '');
    if (!date || !outlet) return NextResponse.json({ ok: false, error: 'date and outlet required' }, { status: 400 });
    const key = `opening_lock:${date}:${outlet}`;
    const row = await (prisma as any).setting.findUnique({ where: { key } });
    return NextResponse.json({ ok: true, locked: !!row, value: row?.value ?? null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
