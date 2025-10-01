import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";
import { canonFull, canonNum } from "@/lib/codeNormalize";

export async function POST(req: Request) {
  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ ok: false, error: "Code required" }, { status: 400 });
    }

    const full = canonFull(code);
    const num = canonNum(code);

    // Fetch people/codes from Setting store
    const row = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
    const list = Array.isArray((row as any)?.value) ? (row as any).value : [];

    const activeSup = list.filter((p: any) => !!p?.active && String(p?.role || "").toLowerCase() === "supervisor");

    let found = activeSup.find((p: any) => canonFull(p?.code || "") === full);
    if (!found && num) {
      const matches = activeSup.filter((p: any) => canonNum(p?.code || "") === num);
      if (matches.length === 1) found = matches[0];
      else if (matches.length > 1) return NextResponse.json({ ok: false, error: "Ambiguous code (multiple matches by number)" }, { status: 409 });
    }

    if (!found) {
      return NextResponse.json({ ok: false, error: "Code not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, name: found?.name || "Supervisor", code: found?.code });
  } catch (e) {
    console.error("supervisor login error", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
