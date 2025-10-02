import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { canonFull } from "@/server/canon";

export async function DELETE(_req: Request, ctx: { params: { code: string } }) {
  try {
    const raw = ctx?.params?.code || "";
    const code = canonFull(raw);
    if (!code) return NextResponse.json({ ok: false, error: "bad-code" }, { status: 400 });
    await (prisma as any).attendantAssignment.delete({ where: { code } }).catch(() => null);
    await (prisma as any).attendantScope.delete({ where: { codeNorm: code } }).catch(() => null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
