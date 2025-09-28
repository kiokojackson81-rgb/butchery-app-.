import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, ctx: { params: { code: string } }) {
  try {
    const code = ctx.params?.code;
    if (!code) return NextResponse.json({ ok: false }, { status: 400 });
    const outlet = await prisma.outlet.findFirst({ where: { code } });
    if (!outlet) return NextResponse.json({ ok: false }, { status: 404 });
    return NextResponse.json({ ok: true, outlet });
  } catch (e) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
