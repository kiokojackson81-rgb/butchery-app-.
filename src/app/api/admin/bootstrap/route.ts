import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [outlets, attendants, assignments] = await Promise.all([
      (prisma as any).outlet.findMany({ orderBy: { code: "asc" } }),
      (prisma as any).attendant.findMany({ orderBy: { name: "asc" } }),
      (prisma as any).attendantAssignment.findMany({ orderBy: { code: "asc" } }),
    ]);

    // Map assignments to scope map for legacy consumer
    const scope: Record<string, { outlet: string; productKeys: string[] }> = {};
    (assignments || []).forEach((a: any) => {
      const key = String(a.code || "").replace(/\s+/g, "").toLowerCase();
      if (!key) return;
      scope[key] = { outlet: a.outlet || "", productKeys: Array.isArray(a.productKeys) ? a.productKeys : [] };
    });

    return NextResponse.json({ ok: true, outlets, attendants, assignments, scope });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
