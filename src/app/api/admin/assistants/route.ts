import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { prisma } from '@/lib/prisma';
import { canonFull } from '@/lib/codeNormalize';

function isAdmin(req: Request): boolean {
  const h = req.headers.get('x-admin-auth') || req.headers.get('x-admin-token');
  return h === 'true' || (h && h.length > 0);
}

async function readList(): Promise<string[]> {
  try {
    const row = await (prisma as any).setting.findUnique({ where: { key: 'general_deposit_attendants' } });
    if (row && row.value) {
      if (Array.isArray(row.value)) return (row.value as any[]).map(v => String(v).toUpperCase());
      if (Array.isArray((row.value as any).codes)) return ((row.value as any).codes as any[]).map(v => String(v).toUpperCase());
    }
  } catch {}
  return [];
}

async function writeList(list: string[]): Promise<void> {
  const key = 'general_deposit_attendants';
  const value = list.map(c => c.toUpperCase());
  try {
    const existing = await (prisma as any).setting.findUnique({ where: { key } });
    if (existing) await (prisma as any).setting.update({ where: { key }, data: { value } });
    else await (prisma as any).setting.create({ data: { key, value } });
  } catch (e) { throw e; }
}

export async function GET(req: Request) {
  try {
    if (!isAdmin(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const url = new URL(req.url);
    const details = url.searchParams.get('details');
    const list = await readList();
    if (details) {
      // Enrich with outlet and product assignments from AttendantScope / AttendantAssignment
      const result: Array<{ code: string; outlet?: string | null; products?: string[] }> = [];
      for (const raw of list) {
        const code = String(raw).toUpperCase();
        let outlet: string | null = null; let products: string[] = [];
        try {
          const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: canonFull(code) }, include: { products: true } });
          if (scope) {
            outlet = String((scope as any).outletName || '') || null;
            products = Array.isArray((scope as any).products) ? ((scope as any).products as any[]).map((p: any) => String(p?.productKey || '')).filter(Boolean) : [];
          } else {
            const assignment = await (prisma as any).attendantAssignment.findUnique({ where: { code: canonFull(code) }, select: { outlet: true, productKeys: true } });
            outlet = String((assignment as any)?.outlet || '') || null;
            products = Array.isArray((assignment as any)?.productKeys) ? ((assignment as any).productKeys as any[]).map((k: any) => String(k || '')).filter(Boolean) : [];
          }
        } catch {}
        result.push({ code, outlet, products });
      }
      return NextResponse.json({ ok: true, list, details: result });
    }
    return NextResponse.json({ ok: true, list });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || 'internal') }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!isAdmin(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const body = await req.json().catch(()=>({}));
    const action = String(body?.action || '').toLowerCase();
    const rawCode = String(body?.code || '').trim();
    if (!action) return NextResponse.json({ ok: false, error: 'action required' }, { status: 400 });
    if ((action === 'add' || action === 'remove') && !rawCode) return NextResponse.json({ ok: false, error: 'code required' }, { status: 400 });
    const code = canonFull(rawCode).toUpperCase();
    let list = await readList();

    if (action === 'add') {
      if (!list.includes(code)) list = [code, ...list];
      await writeList(list);
      return NextResponse.json({ ok: true, list });
    }
    if (action === 'remove') {
      list = list.filter(c => c !== code);
      await writeList(list);
      return NextResponse.json({ ok: true, list });
    }
    if (action === 'set') {
      const codes = Array.isArray(body?.codes) ? body.codes : [];
      const cleaned = codes.map((c: any) => canonFull(String(c)).toUpperCase()).filter((c: string) => c.length > 0);
      await writeList(cleaned);
      return NextResponse.json({ ok: true, list: cleaned });
    }
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || 'internal') }, { status: 500 });
  }
}
