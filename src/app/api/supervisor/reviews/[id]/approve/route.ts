import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params?.id || "";
    if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    const item = await (prisma as any).reviewItem.update({ where: { id }, data: { status: "approved" } });
    return NextResponse.json({ ok: true, item });
  } catch (e: any) {
    console.warn("reviews.approve.fail", e?.message || e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
