import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull } from "@/server/canon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Upsert a PhoneMapping row used for WhatsApp notifications
// Body: { code: string, role: string, phoneE164: string, outlet?: string }
export async function POST(req: Request) {
  try {
    const { code, role, phoneE164, outlet } = (await req.json()) as {
      code: string;
      role: string;
      phoneE164: string;
      outlet?: string | null;
    };

  const c = canonFull(String(code || ""));
    const r = String(role || "").trim();
    const p = String(phoneE164 || "").trim();
    const o = outlet ? String(outlet).trim() : null;
    if (!c || !r || !p) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });

    // upsert by code
    const row = await (prisma as any).phoneMapping.upsert({
      where: { code: c },
      update: { role: r, phoneE164: p, outlet: o },
      create: { code: c, role: r, phoneE164: p, outlet: o },
    });
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
