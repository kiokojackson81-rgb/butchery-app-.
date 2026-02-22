import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull } from "@/server/canon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PUT(req: Request, context: { params: Promise<{ code?: string }> }) {
  try {
    const { code: codeParam } = await context.params;
    const body = await req.json().catch(() => ({}));
    const role = String(body?.role || '').trim();
    const phoneE164 = String(body?.phoneE164 || '').trim();
    const outlet = typeof body?.outlet === 'string' && body.outlet.trim().length > 0 ? String(body.outlet).trim() : null;
    const url = new URL(req.url);
    const canonical = canonFull(String(codeParam || body?.code || url.searchParams.get("code") || ""));
    if (!canonical || !role || !phoneE164) return NextResponse.json({ ok: false, error: 'Missing fields' }, { status: 400 });

    const row = await (prisma as any).phoneMapping.upsert({
      where: { code: canonical },
      update: { role, phoneE164, outlet },
      create: { code: canonical, role, phoneE164, outlet },
    });
    return NextResponse.json({ ok: true, row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || 'Failed') }, { status: 500 });
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ code?: string }> }) {
  try {
    const { code: codeParam } = await context.params;
    const url = new URL(req.url);
    const canonical = canonFull(String(codeParam || url.searchParams.get("code") || ""));
    if (!canonical) return NextResponse.json({ ok: false, error: 'code required' }, { status: 400 });
    await (prisma as any).phoneMapping.deleteMany({ where: { code: canonical } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || 'Failed') }, { status: 500 });
  }
}
