import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canonFull, canonNum } from "@/lib/codeNormalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { code } = (await req.json()) as { code?: string };
    const full = canonFull(code || "");
    const num = canonNum(code || "");
    if (!full && !num) return NextResponse.json({ ok: false, error: "invalid-format" }, { status: 400 });

    // Prefer mirror list to avoid schema coupling
    const row = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
    const list: any[] = Array.isArray((row as any)?.value) ? (row as any).value : [];

    const activePeople = list.filter((p: any) => !!p?.active);

    // 1) Full canonical match (case/space-insensitive)
    let person = activePeople.find((p: any) => canonFull(p?.code || "") === full);

    // 2) Digits-only unique match
    if (!person && num) {
      const matches = activePeople.filter((p: any) => canonNum(p?.code || "") === num);
      if (matches.length === 1) person = matches[0];
      else if (matches.length > 1) return NextResponse.json({ ok: false, error: "Ambiguous code (multiple matches by number)" }, { status: 409 });
    }

    if (!person) return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });

    let outlet: string | null = null;
    const role = String(person.role || "");
    if (role === "attendant") {
      // Try AttendantScope canonical mapping
      const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: canonFull(person.code || "") } });
      outlet = scope?.outletName || person?.outlet || null;
    }
    return NextResponse.json({ ok: true, role, outlet, code: person.code });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
