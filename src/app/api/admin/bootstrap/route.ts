import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const settingsCodesPromise = (prisma as any).setting
      .findUnique({ where: { key: "admin_codes" } })
      .catch(() => null);

    // Outlets / assignments / codes can be loaded in parallel immediately
    const outletsPromise = (prisma as any).outlet.findMany({ orderBy: { code: "asc" } });
    const assignmentsPromise = (prisma as any).attendantAssignment.findMany({ orderBy: { code: "asc" } });
    const codesPromise = (prisma as any).personCode.findMany({ orderBy: { code: "asc" } });

    // Attendants: environment may have drifted (missing salaryAmount column). Attempt structured select then gracefully degrade.
    const attendantsPromise: Promise<any[]> = (async () => {
      try {
        return await (prisma as any).attendant.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, loginCode: true, outletId: true, createdAt: true, updatedAt: true, salaryAmount: true, salaryFrequency: true }
        });
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if (msg.includes("salaryAmount")) {
          // Fallback: raw query without salaryAmount; synthesize defaults
          try {
            const rows: any[] = await (prisma as any).$queryRawUnsafe(
              `SELECT id, name, loginCode, "outletId" as outletId, "createdAt" as createdAt, "updatedAt" as updatedAt FROM "Attendant" ORDER BY name ASC`
            );
            return rows.map(r => ({ ...r, salaryAmount: 0, salaryFrequency: 'daily' }));
          } catch {
            return [];
          }
        }
        return [];
      }
    })();

    const [outlets, attendants, assignments, personCodes, settingsCodesRow] = await Promise.all([
      outletsPromise,
      attendantsPromise,
      assignmentsPromise,
      codesPromise,
      settingsCodesPromise,
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

    // Prefer the canonical People & Codes mirror from Settings (includes salary/outlet fields),
    // fallback to PersonCode rows if Settings is missing or invalid.
    const settingsCodesValue = (settingsCodesRow as any)?.value;
    const codes = Array.isArray(settingsCodesValue) ? settingsCodesValue : personCodes;

    return NextResponse.json({ ok: true, outlets, attendants, assignments, codes, scope });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
