import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { canonFull } from "@/server/canon";

export async function GET() {
  try {
    const rows = await (prisma as any).attendantAssignment.findMany({ orderBy: { code: "asc" } });
    const list = (rows || []).map((r: any) => ({ code: r.code, outlet: r.outlet, productKeys: Array.isArray(r.productKeys) ? r.productKeys : [] }));
    return NextResponse.json({ ok: true, rows: list });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const code = canonFull(String(body?.code || ""));
    const outlet = String(body?.outlet || "").trim();
    const productKeys = Array.isArray(body?.productKeys) ? (body.productKeys as any[]).map((k) => String(k || "")).filter(Boolean) : [];
    if (!code || !outlet) return NextResponse.json({ ok: false, error: "code/outlet required" }, { status: 400 });
    await (prisma as any).attendantAssignment.upsert({
      where: { code },
      update: { outlet, productKeys },
      create: { code, outlet, productKeys },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
