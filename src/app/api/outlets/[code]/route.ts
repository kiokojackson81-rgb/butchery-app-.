import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, ctx: { params: { code: string } }) {
  const raw = (ctx?.params?.code || "").trim();
  if (!raw) {
    return NextResponse.json({ ok: false, error: "code required" }, { status: 400 });
  }
  try {
    const outlet = await (prisma as any).outlet.findFirst({
      where: { code: { equals: raw, mode: "insensitive" } },
      select: { name: true, code: true, active: true },
    });
    return NextResponse.json({ ok: true, outlet: outlet || null });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed" },
      { status: 500 }
    );
  }
}



