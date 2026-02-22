import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { canonFull } from "@/server/canon";

export async function GET() {
  try {
    const list = await (prisma as any).phoneMapping.findMany({ select: { code: true, phoneE164: true } });
    // Always surface canonical codes so UI keys match People & Codes (which are canonicalized)
    const normalized = Array.isArray(list)
      ? list.map((row: any) => ({ code: canonFull(String(row?.code || "")), phoneE164: String(row?.phoneE164 || "") }))
      : [];
    return NextResponse.json(normalized);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { code, role, phoneE164, outlet } = await req.json();
    const canonical = canonFull(String(code || ""));
    const r = String(role || "").trim();
    const p = String(phoneE164 || "").trim();
    const o = typeof outlet === "string" && outlet.trim().length > 0 ? outlet.trim() : undefined;

    if (!canonical || !r || !p) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });

    await (prisma as any).phoneMapping.upsert({
      where: { code: canonical },
      update: { role: r, phoneE164: p, outlet: o },
      create: { code: canonical, role: r, phoneE164: p, outlet: o },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 200 });
  }
}
