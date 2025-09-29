import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/normalizeCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [outlets, attendants, assignments, settingsProducts, settingsPricebook, settingsCodes] = await Promise.all([
      (prisma as any).outlet.findMany({ orderBy: { code: "asc" } }),
      (prisma as any).attendant.findMany({ orderBy: { name: "asc" } }),
      (prisma as any).attendantAssignment.findMany({ orderBy: { code: "asc" } }),
      (prisma as any).setting.findUnique({ where: { key: "admin_products" } }),
      (prisma as any).setting.findUnique({ where: { key: "admin_pricebook" } }),
      (prisma as any).setting.findUnique({ where: { key: "admin_codes" } }),
    ]);

    // Map assignments to scope map for legacy consumer
    const scope: Record<string, { outlet: string; productKeys: string[] }> = {};
    (assignments || []).forEach((a: any) => {
      const key = normalizeCode(String(a.code || ""));
      if (!key) return;
      scope[key] = { outlet: a.outlet || "", productKeys: Array.isArray(a.productKeys) ? a.productKeys : [] };
    });

    const products = Array.isArray((settingsProducts as any)?.value) ? (settingsProducts as any).value : [];
    const pricebook = (settingsPricebook && typeof (settingsPricebook as any).value === "object") ? (settingsPricebook as any).value : {};
    const codes = Array.isArray((settingsCodes as any)?.value) ? (settingsCodes as any).value : [];

    return NextResponse.json({ ok: true, outlets, attendants, assignments, scope, products, pricebook, codes });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
