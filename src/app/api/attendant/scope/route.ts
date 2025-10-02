import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canonFull } from "@/server/canon";

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
    const assignment = await (prisma as any).attendantAssignment.findUnique({ where: { code } });
    const keys = Array.isArray(assignment?.productKeys) ? (assignment.productKeys as any[]).map((k) => String(k || "")) : [];
    return NextResponse.json({ ok: true, outlet: assignment?.outlet || null, productKeys: keys.filter(Boolean).sort() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
