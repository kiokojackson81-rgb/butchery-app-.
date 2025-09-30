import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { code } = (await req.json()) as { code?: string };
    const norm = String(code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{3,10}$/.test(norm)) {
      return NextResponse.json({ ok: false, error: "invalid-format" }, { status: 400 });
    }

    const pc = await (prisma as any).personCode.findFirst({ where: { code: { equals: norm, mode: "insensitive" }, active: true } });
    if (!pc) return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });

    let outlet: string | null = null;
    if (pc.role === "attendant") {
      const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: pc.code } });
      outlet = scope?.outletName || null;
    }
    return NextResponse.json({ ok: true, role: pc.role, outlet, code: pc.code });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
