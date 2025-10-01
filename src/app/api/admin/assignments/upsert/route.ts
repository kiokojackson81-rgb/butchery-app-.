import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/codeNormalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { code, outlet, productKeys } = (await req.json()) as {
      code: string;
      outlet: string;
      productKeys: string[];
    };

    const normalized = normalizeCode(code || "");
    if (!normalized || !outlet) {
      return NextResponse.json({ ok: false, error: "code & outlet required" }, { status: 400 });
    }

    const existing = await (prisma as any).attendantAssignment.findUnique({ where: { code: normalized } });
    if (existing) {
      await (prisma as any).attendantAssignment.update({
        where: { id: existing.id },
        data: { outlet, productKeys },
      });
    } else {
      await (prisma as any).attendantAssignment.create({
        data: { code: normalized, outlet, productKeys },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
