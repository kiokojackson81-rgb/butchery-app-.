import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";

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

    // Write each via SQL UPSERT by code to be resilient to schema drift
    for (const [codeRaw, v] of entries) {
      const code = (codeRaw || "").replace(/\s+/g, "").toLowerCase();
      if (!code) continue;
      const outlet = v.outlet || "";
      const productKeys = Array.isArray(v.productKeys) ? v.productKeys : [];
      await (prisma as any).$executeRawUnsafe(
        'INSERT INTO "AttendantAssignment" (code, outlet, "productKeys", "updatedAt") VALUES ($1, $2, $3::jsonb, NOW())\n         ON CONFLICT (code) DO UPDATE SET outlet = EXCLUDED.outlet, "productKeys" = EXCLUDED."productKeys", "updatedAt" = NOW()',
        code, outlet, JSON.stringify(productKeys)
      );
    }

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
    const code = (searchParams.get("code") || "").trim();
    if (!code) return NextResponse.json({ ok: false, error: "code required" }, { status: 400 });

  await (prisma as any).$executeRawUnsafe('DELETE FROM "AttendantAssignment" WHERE code = $1', code).catch(()=>{});
    // Also clear normalized scope if stored in AttendantScope
    const codeNorm = code.replace(/\s+/g, "").toLowerCase();
    await (prisma as any).attendantScope.delete({ where: { codeNorm } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
