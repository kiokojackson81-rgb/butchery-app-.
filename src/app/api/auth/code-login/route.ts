import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull, canonNum } from "@/lib/codeNormalize";

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
    const { code } = (await req.json().catch(() => ({}))) as { code?: string };
    const full = canonFull(code || "");
    const num = canonNum(code || "");
    if (!full && !num) return NextResponse.json({ ok: false, error: "Invalid or ambiguous code" } as Err, { status: 400 });

    // 1) Find PersonCode.active by full; fallback to digits uniqueness in-memory
    let pc: any = await (prisma as any).personCode.findFirst({ where: { code: { equals: full, mode: "insensitive" }, active: true } });
    if (!pc && num) {
      const all: any[] = await (prisma as any).personCode.findMany({ where: { active: true } });
      const matches = all.filter((p: any) => canonNum(p.code || "") === num);
      if (matches.length === 1) pc = matches[0];
      else return NextResponse.json({ ok: false, error: "Invalid or ambiguous code" } as Err, { status: 409 });
    }
    if (!pc) return NextResponse.json({ ok: false, error: "Invalid or ambiguous code" } as Err, { status: 404 });

    const role = String(pc.role || "").toLowerCase();
    if (!(["attendant", "supervisor", "supplier"].includes(role))) {
      return NextResponse.json({ ok: false, error: "Invalid or ambiguous code" } as Err, { status: 400 });
    }

    // 2) Resolve outlet for attendants
    let outlet: string | null = null;
    if (role === "attendant") {
      const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: canonFull(pc.code || full) } });
      outlet = (scope as any)?.outletName || null;
      if (!outlet) {
        const pm = await (prisma as any).phoneMapping.findFirst({ where: { code: { equals: pc.code, mode: "insensitive" } } });
        outlet = (pm as any)?.outlet || null;
      }
    }

    // 3) Create a pending login session keyed by code (consumed by webhook on first inbound)
    const pendingKey = `+PENDING:${canonFull(pc.code || full)}`;
    await (prisma as any).waSession.upsert({
      where: { phoneE164: pendingKey },
      update: { role, code: canonFull(pc.code || full), outlet, state: "LOGIN", cursor: { issuedAt: Date.now() } },
      create: { phoneE164: pendingKey, role, code: canonFull(pc.code || full), outlet, state: "LOGIN", cursor: { issuedAt: Date.now() } },
    });

    // 4) Build deep link
    const link = waDeepLink();
    if (!link) return NextResponse.json({ ok: false, error: "WA not configured" } as Err, { status: 500 });

    return NextResponse.json({ ok: true, role, code: canonFull(pc.code || full), outlet, waDeepLink: link } as Ok);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" } as Err, { status: 500 });
  }
}
