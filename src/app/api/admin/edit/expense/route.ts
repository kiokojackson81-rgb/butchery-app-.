import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

type Body = { id: string; amount?: number; name?: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(()=>({}))) as Body;
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
    const data: any = {};
    if (Number.isFinite(body.amount as any)) data.amount = Number(body.amount);
    if (typeof body.name === "string") data.name = body.name;
    if (Object.keys(data).length === 0) return NextResponse.json({ ok: false, error: "no fields to update" }, { status: 400 });

    const before = await (prisma as any).attendantExpense.findUnique({ where: { id } }).catch(()=>null);
    if (!before) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const after = await (prisma as any).attendantExpense.update({ where: { id }, data });

    try {
      const key = `admin_edit:${Date.now()}:expense:${id}`;
      await (prisma as any).setting.create({ data: { key, value: { type: 'expense', id, at: new Date().toISOString(), before, after } } });
    } catch {}

    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
