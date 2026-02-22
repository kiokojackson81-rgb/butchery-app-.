import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/codeNormalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function removeCodeCascade(rawCode: string): Promise<boolean> {
  const canonical = normalizeCode(rawCode || "");
  if (!canonical) return false;
  const client = prisma as any;
  try { await client.phoneMapping.deleteMany({ where: { code: canonical } }); } catch {}
  try { await client.waSession.updateMany({ where: { code: canonical }, data: { code: null, state: "IDLE", cursor: null } }); } catch {}
  try { await client.attendantAssignment.deleteMany({ where: { code: canonical } }); } catch {}
  try { await client.attendantScope.deleteMany({ where: { codeNorm: canonical } }); } catch {}
  try { await client.loginCode.deleteMany({ where: { code: { equals: canonical, mode: "insensitive" } } }); } catch {}
  try {
    const att = await client.attendant.findFirst({ where: { loginCode: { equals: canonical, mode: "insensitive" } } });
    if (att?.id) {
      try { await client.session.deleteMany({ where: { attendantId: att.id } }); } catch {}
      try { await client.waMessageLog.updateMany({ where: { attendantId: att.id }, data: { attendantId: null } }); } catch {}
      try { await client.attendant.delete({ where: { id: att.id } }); } catch {}
    }
  } catch {}
  try { const res = await client.personCode.delete({ where: { code: canonical } }); return !!res; } catch { return false; }
}

export async function DELETE(req: Request, context: { params: Promise<{ code?: string }> }) {
  try {
    const { code: codeParam } = await context.params;
    const url = new URL(req.url);
    const raw =
      typeof codeParam === "string" && codeParam.trim()
        ? codeParam
        : url.searchParams.get("code") || url.searchParams.get("nxtPcode") || "";
    const code = normalizeCode(raw || '');
    if (!code) return NextResponse.json({ ok: false, error: 'Invalid code' }, { status: 400 });

    const removed = await removeCodeCascade(code).catch(() => false);
    if (!removed) return NextResponse.json({ ok: false, error: 'Delete failed' }, { status: 500 });

    // Update admin_codes mirror: rewrite to list of remaining people
    try {
      const existing = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } }).catch(() => null);
      const current = Array.isArray((existing as any)?.value) ? ((existing as any).value as any[]) : null;
      if (current) {
        const payload = current.filter((r: any) => normalizeCode(String(r?.code || "")) !== code);
        await (prisma as any).setting.upsert({ where: { key: "admin_codes" }, update: { value: payload }, create: { key: "admin_codes", value: payload } });
      } else {
        const rows = await (prisma as any).personCode.findMany({ select: { code: true, name: true, role: true, active: true } });
        const payload = (rows || []).map((r: any) => ({ code: r.code, name: r.name, role: r.role, active: r.active }));
        await (prisma as any).setting.upsert({ where: { key: "admin_codes" }, update: { value: payload }, create: { key: "admin_codes", value: payload } });
      }
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || 'Failed') }, { status: 500 });
  }
}
