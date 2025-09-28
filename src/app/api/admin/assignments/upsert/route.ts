import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

    if (!code || !outlet) return NextResponse.json({ ok: false, error: "code & outlet required" }, { status: 400 });

    // Store normalized code (lowercase, no whitespace) so login can match reliably
    const norm = code.trim().replace(/\s+/g, "").toLowerCase();
    const existing = await (prisma as any).attendantAssignment.findFirst({ where: { code: norm } });
    if (existing) {
      await (prisma as any).attendantAssignment.update({
        where: { id: existing.id },
        data: { code: norm, outlet, productKeys },
      });
    } else {
      await (prisma as any).attendantAssignment.create({
        data: { id: `aa_${Date.now()}`, code: norm, outlet, productKeys },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
