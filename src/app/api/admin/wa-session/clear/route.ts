import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Key check removed to allow no-key admin actions in local/internal scenarios.

export async function POST(req: Request) {
  try {
  // Previously enforced STATUS_PUBLIC_KEY via header/query. Now removed.

    const body = await req.json().catch(() => ({})) as { phone?: string; code?: string };
    const phone = (body.phone || "").trim();
    const code = (body.code || "").trim();
    if (!phone && !code) return NextResponse.json({ ok: false, error: "missing phone or code" }, { status: 400 });

    let count = 0;
    if (phone) {
      try {
        const r = await (prisma as any).waSession.deleteMany({ where: { phoneE164: phone } });
        count += Number(r?.count || 0);
      } catch {}
    }
    if (code) {
      try {
        const r = await (prisma as any).waSession.deleteMany({ where: { code } });
        count += Number(r?.count || 0);
      } catch {}
    }

    return NextResponse.json({ ok: true, deleted: count });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
