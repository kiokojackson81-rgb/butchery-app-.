import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    // Bulk mode: { outlets: [{ name, code?, active? }, ...] }
    if (Array.isArray(body?.outlets)) {
      let count = 0;
      for (const o of body.outlets) {
        const name = (o?.name || "").trim();
        if (!name) continue;
        const code = (o?.code ?? null) as string | null;
        const active = Boolean(o?.active ?? true);
        // Upsert by name when possible; fallback to code if provided
        const existing = await (prisma as any).outlet.findFirst({ where: code ? { OR: [{ name }, { code }] } : { name } });
        if (existing) {
          await (prisma as any).outlet.update({ where: { id: existing.id }, data: { name, code, active } });
        } else {
          await (prisma as any).outlet.create({ data: { id: `out_${Date.now()}_${Math.random().toString(36).slice(2)}`, name, code, active } });
        }
        count++;
      }
      return NextResponse.json({ ok: true, count });
    }

    // Single mode: { code, name, active? }
    const { code, name, active = true } = (body || {}) as { code?: string; name?: string; active?: boolean };
    if (!name) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
    const existing = await (prisma as any).outlet.findFirst({ where: code ? { OR: [{ name }, { code }] } : { name } });
    if (existing) {
      await (prisma as any).outlet.update({ where: { id: existing.id }, data: { name, code: code ?? existing.code, active } });
    } else {
      await (prisma as any).outlet.create({ data: { id: `out_${Date.now()}`, code: code ?? null, name, active } });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("/api/admin/outlets/upsert POST error", e);
    return NextResponse.json({ ok: false, code: "ERR_SERVER", message: "Server error" }, { status: 500 });
  }
}
