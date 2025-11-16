import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

// POST { id, closingQty?, wasteQty?, reason? }
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(()=>({}));
    const id = String(body?.id || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });

    const data: any = {};
    if (typeof body?.closingQty === 'number' && Number.isFinite(body.closingQty)) data.closingQty = body.closingQty;
    if (typeof body?.wasteQty === 'number' && Number.isFinite(body.wasteQty)) data.wasteQty = body.wasteQty;

    const row = await (prisma as any).attendantClosing.update({ where: { id }, data });
    return NextResponse.json({ ok: true, row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

type Body = { id: string; closingQty?: number; wasteQty?: number; reason?: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(()=>({}))) as Body;
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
    const data: any = {};
    if (Number.isFinite(body.closingQty as any)) data.closingQty = Number(body.closingQty);
    if (Number.isFinite(body.wasteQty as any)) data.wasteQty = Number(body.wasteQty);
    if (Object.keys(data).length === 0) return NextResponse.json({ ok: false, error: "no fields to update" }, { status: 400 });

    const before = await (prisma as any).attendantClosing.findUnique({ where: { id } }).catch(()=>null);
    if (!before) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const after = await (prisma as any).attendantClosing.update({ where: { id }, data });

    try {
      const key = `admin_edit:${Date.now()}:closing:${id}`;
      await (prisma as any).setting.create({ data: { key, value: { type: 'closing', id, at: new Date().toISOString(), before, after, reason: (body as any)?.reason || undefined } } });
    } catch {}

    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
