import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ ok: false, error: "Code required" }, { status: 400 });
    }

    const norm = code.replace(/\s+/g, "").toLowerCase();

    // 1) Primary: AttendantAssignment table (normalized code)
    const row = await (prisma as any).attendantAssignment.findUnique({ where: { code: norm } });
    if (row && (row as any).outlet) {
      const keys = Array.isArray((row as any).productKeys) ? (row as any).productKeys : [];
      return NextResponse.json({ ok: true, outlet: (row as any).outlet, productKeys: keys });
    }

    // 2) Fallback A: Settings key 'attendant_scope' (thin persistence in DB)
    const scopeRow = await (prisma as any).setting.findUnique({ where: { key: "attendant_scope" } });
    const scopeMap = (scopeRow && typeof (scopeRow as any).value === "object") ? (scopeRow as any).value : {};
    if (scopeMap && scopeMap[norm] && scopeMap[norm].outlet) {
      const entry = scopeMap[norm];
      const keys = Array.isArray(entry.productKeys) ? entry.productKeys : [];
      return NextResponse.json({ ok: true, outlet: entry.outlet, productKeys: keys });
    }

    // 3) Fallback B: Legacy outlet code mapping + product activation from settings
    const outletsRow = await (prisma as any).setting.findUnique({ where: { key: "admin_outlets" } });
    const productsRow = await (prisma as any).setting.findUnique({ where: { key: "admin_products" } });
    const pricebookRow = await (prisma as any).setting.findUnique({ where: { key: "admin_pricebook" } });
    const outlets = Array.isArray((outletsRow as any)?.value) ? (outletsRow as any).value : [];
    const products = Array.isArray((productsRow as any)?.value) ? (productsRow as any).value : [];
    const pbMap = (pricebookRow && typeof (pricebookRow as any).value === "object") ? (pricebookRow as any).value : {};

    const outletHit = outlets.find((o: any) => {
      const c = (o?.code || "").toString();
      return (o?.active === true) && c.replace(/\s+/g, "").toLowerCase() === norm;
    });

    if (outletHit && outletHit.name) {
      const outletName = outletHit.name as string;
      // Compute allowed products: start with globally active
      const activeGlobalKeys = products.filter((p: any) => p?.active).map((p: any) => p?.key).filter(Boolean);
      const set = new Set<string>(activeGlobalKeys as string[]);
      // Apply outlet pricebook if present: disable those explicitly inactive
      const outletPB = pbMap?.[outletName] || {};
      Object.keys(outletPB).forEach((k) => { if (outletPB[k]?.active === false) set.delete(k); });
      // Keep keys as array
      const productKeys = Array.from(set);
      return NextResponse.json({ ok: true, outlet: outletName, productKeys });
    }

    // No mapping found in DB
    return NextResponse.json({ ok: false, error: "Code not found" }, { status: 404 });
  } catch (e) {
    console.error("attendant login error", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
