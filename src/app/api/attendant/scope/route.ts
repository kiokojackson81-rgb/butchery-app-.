import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canonFull } from "@/server/canon";
import { upsertAssignmentForCode } from "@/server/assignments";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get("code") || "").trim();

    let code = canonFull(raw);
    if (!code) {
      const sess = await getSession();
      code = canonFull(sess?.attendant?.loginCode || "");
    }
    if (!code) return NextResponse.json({ ok: false, error: "code not resolved" }, { status: 400 });

    // Prefer AttendantScope table
    const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: code }, include: { products: true } });
    if (scope) {
      const productKeys = (scope.products || []).map((p: any) => String(p.productKey || "")).filter(Boolean).sort();
      return NextResponse.json({ ok: true, outlet: scope.outletName || null, productKeys });
    }

    // Fallback to AttendantAssignment
    let assignment = await (prisma as any).attendantAssignment.findUnique({ where: { code } });
    let outletName = String(assignment?.outlet || "").trim() || null;
    let keys = Array.isArray(assignment?.productKeys) ? (assignment.productKeys as any[]).map((k) => String(k || "")).filter(Boolean).sort() : [];

    // Extra fallback: consult Setting('attendant_scope') mirror
    if (!outletName || keys.length === 0) {
      try {
        const scopeRow = await (prisma as any).setting.findUnique({ where: { key: "attendant_scope" } });
        const map = (scopeRow as any)?.value || null;
        if (map && typeof map === "object") {
          const entry = (map as any)[code] || null;
          if (entry && typeof entry === "object") {
            const outRaw = String((entry as any).outlet || "").trim();
            const keysRaw = Array.isArray((entry as any).productKeys) ? (entry as any).productKeys as any[] : [];
            const extra = keysRaw.map((k: any) => String(k || "").trim()).filter((k: string) => k.length > 0).sort();
            if (outRaw) outletName = outRaw;
            if (extra.length > 0) keys = extra;
          }
        }
      } catch {}
    }

    // IMPORTANT: Do NOT auto-derive products from pricebook. If no explicit assignment
    // is found, return an empty list so attendants only see products they manage.

    return NextResponse.json({ ok: true, outlet: outletName, productKeys: keys });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
