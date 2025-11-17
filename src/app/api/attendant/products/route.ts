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

    // Case-insensitive normalization: dedupe assigned keys by lowercase
    const lcAssigned = Array.from(new Set(productKeys.map((k) => String(k).trim()).filter((k) => k.length > 0).map((k) => k.toLowerCase())));

    // Fetch products for both original and lowercased keys; map by lowercase for consistent lookup
    const prodQueryKeys = Array.from(new Set([...productKeys, ...lcAssigned]));
    const productRows = await (prisma as any).product.findMany({
      where: { key: { in: prodQueryKeys } },
      select: { key: true, name: true },
    });
    const canonicalKeyByLc = new Map<string, string>();
    const nameByLc = new Map<string, string>();
    for (const p of (productRows as any[])) {
      const key = String(p?.key || "");
      if (!key) continue;
      const lc = key.toLowerCase();
      // Prefer the first seen canonical key; Product.key is our source of truth
      if (!canonicalKeyByLc.has(lc)) canonicalKeyByLc.set(lc, key);
      if (!nameByLc.has(lc)) nameByLc.set(lc, String(p?.name || key));
    }

    // Fetch all pricebook rows for this outlet and filter locally by lowercase match
    const pbAll = await (prisma as any).pricebookRow.findMany({
      where: { outletName },
      select: { productKey: true, sellPrice: true, active: true },
    });
    const priceByLc = new Map<string, { price: number; active: boolean }>();
    for (const r of (pbAll as any[])) {
      const lc = String(r?.productKey || "").toLowerCase();
      if (!lcAssigned.includes(lc)) continue;
      priceByLc.set(lc, { price: Number(r?.sellPrice || 0), active: !!r?.active });
    }

    // Build response rows in the order of the original assignment, deduped by lowercase
    const seen = new Set<string>();
    const rows: ProductOut[] = [];
    for (const raw of productKeys) {
      const lc = String(raw).toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      const canonicalKey = canonicalKeyByLc.get(lc) || lc;
      const name = nameByLc.get(lc) || canonicalKey;
      const pb = priceByLc.get(lc);
      const active = !!pb?.active;
      rows.push({
        key: canonicalKey,
        name,
        price: active ? Number(pb!.price) : null,
        updatedAt: null,
        active,
      });
    }

    return NextResponse.json({ ok: true, outlet: outletName, attendantCode: code, products: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
