import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canonFull } from "@/lib/codeNormalize";
import { getRoleSession } from "@/lib/roleSession";
import { upsertAssignmentForCode } from "@/server/assignments";

type ProductOut = {
  key: string;
  name: string;
  price: number | null;      // null => no active pricebook row
  updatedAt: string | null;
  active: boolean;           // reflects pricebook active flag (false when absent or inactive)
};

export async function GET() {
  try {
    const sess = await getSession();
    let code = canonFull((sess as any)?.attendant?.loginCode || "");
    if (!code) {
      // Fallback to role cookie for resilience
      const role = await getRoleSession();
      if (role && role.role === "attendant") {
        code = canonFull(role.code || "");
      }
    }
    if (!code) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    // Resolve outlet + product keys: prefer normalized AttendantScope; fallback to legacy AttendantAssignment
    let outletName: string | null = null;
    let productKeys: string[] = [];

    const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: code }, include: { products: true } });
    if (scope) {
      outletName = String((scope as any).outletName || "").trim() || null;
      productKeys = Array.isArray((scope as any).products)
        ? ((scope as any).products as any[])
            .map((p: any) => String(p?.productKey || "").trim())
            .filter((k) => k.length > 0)
            .sort()
        : [];
    } else {
      const assignment = await (prisma as any).attendantAssignment.findUnique({ where: { code }, select: { outlet: true, productKeys: true } });
      outletName = String((assignment as any)?.outlet || "").trim() || null;
      productKeys = Array.isArray((assignment as any)?.productKeys)
        ? (((assignment as any).productKeys as any[]) || [])
            .map((k) => String(k || "").trim())
            .filter(Boolean)
            .sort()
        : [];
    }

    // Fallback: consult Setting('attendant_scope') mirror if DB tables don't have entries yet
    if ((!outletName || productKeys.length === 0)) {
      try {
        const scopeRow = await (prisma as any).setting.findUnique({ where: { key: "attendant_scope" } });
        const map = (scopeRow as any)?.value || null;
        if (map && typeof map === "object") {
          const entry = (map as any)[code] || null;
          if (entry && typeof entry === "object") {
            const outRaw = String((entry as any).outlet || "").trim();
            const keysRaw = Array.isArray((entry as any).productKeys) ? (entry as any).productKeys as any[] : [];
            const keys = keysRaw.map((k: any) => String(k || "").trim()).filter((k: string) => k.length > 0).sort();
            if (outRaw) outletName = outRaw;
            if (keys.length > 0) productKeys = keys;
          }
        }
      } catch {}
    }

    // IMPORTANT: Do NOT auto-derive products from pricebook. If no explicit assignment
    // is found, return an empty list so attendants only see products they manage.

    if (!outletName || productKeys.length === 0) {
      return NextResponse.json({ ok: true, outlet: outletName, attendantCode: code, products: [] as ProductOut[] });
    }

    // Fetch product names for the assigned keys
    const products = await (prisma as any).product.findMany({
      where: { key: { in: productKeys } },
      select: { key: true, name: true },
    });
    const nameByKey = new Map<string, string>(products.map((p: any) => [String(p.key), String(p.name || p.key)] as const));

    // Fetch outlet pricebook rows, filter to active only
    const pbRows = await (prisma as any).pricebookRow.findMany({
      where: { outletName, productKey: { in: productKeys } },
      select: { productKey: true, sellPrice: true, active: true },
    });
    const priceByKey = new Map<string, { price: number; active: boolean; updatedAt: Date | null }>();
    for (const r of pbRows as any[]) {
      priceByKey.set(String(r.productKey), { price: Number(r.sellPrice || 0), active: !!r.active, updatedAt: null });
    }

    const rows: ProductOut[] = productKeys.map((key) => {
      const pb = priceByKey.get(key);
      const active = !!pb?.active;
      return {
        key,
        name: nameByKey.get(key) || key,
        price: active ? pb!.price : null,
        updatedAt: pb?.updatedAt ? pb.updatedAt.toISOString() : null,
        active,
      };
    });

  return NextResponse.json({ ok: true, outlet: outletName, attendantCode: code, products: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
