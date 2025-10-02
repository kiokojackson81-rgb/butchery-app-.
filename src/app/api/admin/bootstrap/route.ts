import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [outlets, attendants, assignments, personCodes] = await Promise.all([
      (prisma as any).outlet.findMany({ orderBy: { code: "asc" } }),
      (prisma as any).attendant.findMany({ orderBy: { name: "asc" } }),
      (prisma as any).attendantAssignment.findMany({ orderBy: { code: "asc" } }),
      (prisma as any).personCode.findMany({ orderBy: { code: "asc" } }),
    ]);

    // Compose a DB-first attendant scope map to hydrate Admin Assignments UI
    // Prefer normalized AttendantScope + ScopeProduct; fallback to legacy AttendantAssignment
    type ScopeMap = Record<string, { outlet: string; productKeys: string[] }>;
    const scope: ScopeMap = {};

    try {
      const scopes = await (prisma as any).attendantScope.findMany({ include: { products: true } });
      for (const s of scopes as any[]) {
        const code = String(s?.codeNorm || "");
        if (!code) continue;
        const outlet = String(s?.outletName || "");
        const keys = Array.isArray(s?.products)
          ? (s.products as any[])
              .map((p) => String(p?.productKey || "").trim())
              .filter((k) => k.length > 0)
              .sort()
          : [];
        scope[code] = { outlet, productKeys: keys };
      }
    } catch (e) {
      // non-fatal; fallback below
    }

    // Fill any missing via legacy AttendantAssignment table
    for (const a of assignments as any[]) {
      const code = String(a?.code || "");
      if (!code || scope[code]) continue;
      const outlet = String(a?.outlet || "");
      const rawKeys = Array.isArray(a?.productKeys) ? (a.productKeys as any[]) : [];
      const keys = rawKeys
        .map((k) => String(k || "").trim())
        .filter((k) => k.length > 0)
        .sort();
      scope[code] = { outlet, productKeys: keys };
    }

    return NextResponse.json({ ok: true, outlets, attendants, assignments, codes: personCodes, scope });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
