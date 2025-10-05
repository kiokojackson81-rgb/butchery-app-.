import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull, canonNum } from "@/lib/codeNormalize";
import { findPersonCodeTolerant } from "@/server/db_person";
import { finalizeLoginDirect } from "@/app/api/wa/auth/finalize/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function waDeepLink(): string | null {
  const num = (process.env.NEXT_PUBLIC_WA_PUBLIC_E164 || "").replace(/[^0-9]/g, "");
  if (!num) return null;
  return `https://wa.me/${num}`;
}

type Ok = { ok: true; role: "attendant" | "supervisor" | "supplier"; code: string; outlet: string | null; waDeepLink: string };
type Err = { ok: false; error: string };

export async function POST(req: Request) {
  try {
    const { code, wa } = (await req.json().catch(() => ({}))) as { code?: string; wa?: string };
    const full = canonFull(code || "");
    if (!full) return NextResponse.json({ ok: false, error: "Invalid or ambiguous code" } as Err, { status: 400 });

    const pc: any = await findPersonCodeTolerant(full);
    if (!pc) return NextResponse.json({ ok: false, error: "Invalid or ambiguous code" } as Err, { status: 404 });
    const role = String(pc.role || "").toLowerCase() as Ok["role"];

    // Optional direct finalize when wa known
    if (wa) {
      await finalizeLoginDirect(wa, pc.code).catch(() => null);
    } else {
      // Create pending session for webhook finalize
      await (prisma as any).waSession.upsert({
        where: { phoneE164: `+PENDING:${pc.code}` },
        update: { role, code: pc.code, outlet: null, state: "LOGIN", cursor: { issuedAt: Date.now() } },
        create: { phoneE164: `+PENDING:${pc.code}`, role, code: pc.code, outlet: null, state: "LOGIN", cursor: { issuedAt: Date.now() } },
      });
    }
    const link = waDeepLink(); if (!link) return NextResponse.json({ ok: false, error: "WA not configured" } as Err, { status: 500 });
    return NextResponse.json({ ok: true, role, code: pc.code, outlet: null, waDeepLink: link } as Ok);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" } as Err, { status: 500 });
  }
}
