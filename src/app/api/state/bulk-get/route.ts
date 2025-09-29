import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const { keys } = (await req.json().catch(() => ({}))) as { keys?: string[] };
    if (!Array.isArray(keys) || keys.length === 0) {
      return NextResponse.json({ ok: false, error: "keys required" }, { status: 400 });
    }
  const rows = await (prisma as any).appState.findMany({ where: { key: { in: keys } } });
    const map: Record<string, any> = {};
    for (const r of rows) map[r.key] = r.value;
    return NextResponse.json({ ok: true, data: map });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
