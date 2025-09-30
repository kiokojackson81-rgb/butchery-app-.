import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { items } = (await req.json().catch(() => ({}))) as { items?: Array<{ key: string; value: any }> };
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ ok: false, error: "items required" }, { status: 400 });
    }
    await (prisma as any).$transaction(
      items.map(({ key, value }) =>
        (prisma as any).appState.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        })
      )
    );
    return NextResponse.json({ ok: true, count: items.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
