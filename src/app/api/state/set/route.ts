import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { key, value } = (await req.json().catch(() => ({}))) as { key?: string; value?: any };
    if (!key) return NextResponse.json({ ok: false, error: "key required" }, { status: 400 });
    try {
      await (prisma as any).appState.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error("AppState set failed:", String(err?.message ?? err));
      return NextResponse.json({ ok: false, error: "appstate_unavailable" }, { status: 503 });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
