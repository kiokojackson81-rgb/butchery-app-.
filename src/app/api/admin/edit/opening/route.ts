import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

type Body = { id: string; qty?: number; unit?: string; buyPrice?: number; reason?: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(()=>({}))) as Body;
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
    const data: any = {};
    if (Number.isFinite(body.qty as any)) data.qty = Number(body.qty);
    if (typeof body.unit === "string") data.unit = body.unit;
    if (Number.isFinite(body.buyPrice as any)) data.buyPrice = Number(body.buyPrice);
    if (Object.keys(data).length === 0) return NextResponse.json({ ok: false, error: "no fields to update" }, { status: 400 });

    const before = await (prisma as any).supplyOpeningRow.findUnique({ where: { id } }).catch(()=>null);
    if (!before) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const after = await (prisma as any).supplyOpeningRow.update({ where: { id }, data });

    try {
      const key = `admin_edit:${Date.now()}:opening:${id}`;
      await (prisma as any).setting.create({ data: { key, value: { type: 'opening', id, at: new Date().toISOString(), before, after, reason: (body as any)?.reason || undefined } } });
    } catch {}

    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
