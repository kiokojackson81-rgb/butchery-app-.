import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

// Expose the public, dialable WA number we send users to.
const WA_PUBLIC_E164 = process.env.NEXT_PUBLIC_WA_PUBLIC_E164?.replace(/^\+/, ""); // e.g. 254107651410

// Build a best-effort deep link for both mobile & desktop.
function buildWaLink(text: string) {
  const encoded = encodeURIComponent(text);
  // Desktop/web WhatsApp and Android often handle wa.me well
  const waMe = `https://wa.me/${WA_PUBLIC_E164}?text=${encoded}`;
  // iOS prefers the custom scheme; we’ll return both to the client
  const ios = `whatsapp://send?phone=${WA_PUBLIC_E164}&text=${encoded}`;
  return { waMe, ios };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    if (!WA_PUBLIC_E164) {
      return NextResponse.json({ ok: false, error: "Missing NEXT_PUBLIC_WA_PUBLIC_E164" }, { status: 500 });
    }

    const { code } = (await req.json()) as { code?: string };
    const raw = String(code || "").trim();
    const norm = raw.toUpperCase();

    // 1) quick validation: 3–10 alphanum
    if (!/^[A-Z0-9]{3,10}$/.test(norm)) {
      return NextResponse.json({ ok: false, error: "Invalid code format" }, { status: 400 });
    }

    // 2) check PersonCode and status (attendant | supervisor | supplier)
    const pc = await (prisma as any).personCode.findFirst({ where: { code: { equals: norm, mode: "insensitive" }, active: true } });
    if (!pc) {
      return NextResponse.json({ ok: false, error: "Code not found or inactive" }, { status: 404 });
    }

    // 3) mint a short-lived nonce to allow login without retyping the code in WA
    const nonce = crypto.randomBytes(3).toString("hex").toUpperCase(); // e.g. "A1B2C3"

    // Upsert a small “link intent” into WaSession keyed by a special phoneE164 (non-real phone)
    // We store minimal info; actual phone binding happens when the inbound WA hits.
    const linkPhone = `+LINK:${nonce}`;
    await (prisma as any).waSession.upsert({
      where: { phoneE164: linkPhone },
      create: {
        phoneE164: linkPhone,
        role: pc.role,
        code: pc.code,
        outlet: null,
        state: "LOGIN_PENDING",
        cursor: { code: pc.code, role: pc.role, nonce, createdAt: new Date().toISOString() } as any,
      },
      update: {
        role: pc.role,
        code: pc.code,
        state: "LOGIN_PENDING",
        cursor: { code: pc.code, role: pc.role, nonce, updatedAt: new Date().toISOString() } as any,
      },
    });

    // 4) Build the WA message users will send. Prefer a short, unique token:
    // The WA handler will accept either "LOGIN <CODE>" or "LINK <NONCE>"
    const text = `LINK ${nonce}`;

    const links = buildWaLink(text);
    return NextResponse.json({
      ok: true,
      waText: text,
      links,
      hint: `Send "${text}" in WhatsApp to complete login.`,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server error" }, { status: 500 });
  }
}
