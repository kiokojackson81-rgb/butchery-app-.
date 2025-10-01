import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/codeNormalize";

/**
 * Body shape:
 * {
 *   "<normalizedCode>": { outlet: "Baraka A", productKeys: ["beef","goat"] },
 *   ...
 * }
 */
export async function POST(req: Request) {
  try {
    const scope = await req.json();
    if (!scope || typeof scope !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const entries = Object.entries(scope) as Array<[
      string,
      { outlet?: string; productKeys?: string[] }
    ]>;

    await Promise.all(
      entries.map(([code, v]) => {
        const canonical = normalizeCode(code);
        if (!canonical) return Promise.resolve();
        return (prisma as any).attendantAssignment.upsert({
          where: { code: canonical },
          update: { outlet: v.outlet || "", productKeys: v.productKeys || [] },
          create: { code: canonical, outlet: v.outlet || "", productKeys: v.productKeys || [] },
        });
      })
    );

    return NextResponse.json({ ok: true, count: entries.length });
  } catch (e) {
    console.error("save scope error", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

// DELETE /api/admin/scope?code=<loginCode>
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const canonical = normalizeCode(searchParams.get("code") || "");
    if (!canonical) return NextResponse.json({ ok: false, error: "code required" }, { status: 400 });

    await (prisma as any).attendantAssignment.delete({ where: { code: canonical } }).catch(() => {});
    // Also clear normalized scope if stored in AttendantScope
    await (prisma as any).attendantScope.delete({ where: { codeNorm: canonical } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
