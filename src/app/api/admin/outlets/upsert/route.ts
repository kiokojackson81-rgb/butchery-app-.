import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull } from "@/lib/codeNormalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const outlets = Array.isArray(body?.outlets) ? body.outlets : (body && body.code && body.name ? [body] : []);
    if (!Array.isArray(outlets) || outlets.length === 0) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });

    let count = 0;
    for (const o of outlets) {
      if (!o?.name) continue;
      const code = (o?.code ? canonFull(String(o.code)) : null) as string | null;
      const active = !!o?.active;
      const name = String(o.name);
      const existing = await (prisma as any).outlet.findFirst({ where: { name } });
      if (existing) {
        await (prisma as any).outlet.update({ where: { id: existing.id }, data: { code, active, name } });
      } else {
        await (prisma as any).outlet.create({ data: { name, code, active } });
      }
      count++;
    }

    // Mirror full list as provided
    await (prisma as any).setting.upsert({
      where: { key: "admin_outlets" },
      update: { value: outlets },
      create: { key: "admin_outlets", value: outlets },
    });

    return NextResponse.json({ ok: true, count });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}
