import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/codeNormalize";
import { notifyAttendantAssignmentChange, upsertAssignmentForCode } from "@/server/assignments";

type ScopePayload = Record<string, { outlet?: string; productKeys?: unknown }>;

type ScopeEntry = { outlet: string; productKeys: string[] };

function sanitizeEntry(value: { outlet?: string; productKeys?: unknown }): ScopeEntry | null {
  const outlet = typeof value?.outlet === "string" ? value.outlet.trim() : "";
  if (!outlet) return null;
  const keys = Array.isArray(value?.productKeys)
    ? Array.from(new Set(
        value.productKeys
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim())
          .filter((k) => k.length > 0)
      )).sort()
    : [];
  return { outlet, productKeys: keys };
}

/**
 * Body shape:
 * {
 *   "<loginCode>": { outlet: "Baraka A", productKeys: ["beef","goat"] },
 *   ...
 * }
 */
export async function POST(req: Request) {
  try {
    const scope = (await req.json()) as ScopePayload;
    if (!scope || typeof scope !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    // 1) Build a sanitized map of incoming changes (canonical codes)
    const incoming: Record<string, ScopeEntry> = {};
    for (const [rawCode, raw] of Object.entries(scope)) {
      const entry = sanitizeEntry(raw || {});
      const canonical = normalizeCode(rawCode || "");
      if (!canonical || !entry) continue;
      incoming[canonical] = entry;
    }

    // 2) Build current ownership baseline from normalized scope table first, then legacy assignment
    type Owner = { outlet: string; ownerCode: string };
    const owners = new Map<string, Owner>(); // key: `${outlet}__${productKey}` -> { outlet, ownerCode }

    // Helper to set owner if not already set (first source wins)
    const setOwner = (outlet: string, productKey: string, code: string) => {
      const k = `${outlet}__${productKey}`;
      if (!owners.has(k)) owners.set(k, { outlet, ownerCode: code });
    };

    // AttendantScope baseline
    try {
      const scopes = await (prisma as any).attendantScope.findMany({ include: { products: true } });
      for (const s of (scopes || []) as any[]) {
        const code = String(s?.codeNorm || "");
        const outlet = String(s?.outletName || "");
        if (!code || !outlet) continue;
        const keys = Array.isArray(s?.products)
          ? (s.products as any[]).map((p: any) => String(p?.productKey || "").trim()).filter((k: string) => k.length > 0)
          : [];
        for (const pk of keys) setOwner(outlet, pk, code);
      }
    } catch {}

    // Legacy AttendantAssignment baseline (fill only where not already set)
    try {
      const assigns = await (prisma as any).attendantAssignment.findMany({});
      for (const a of (assigns || []) as any[]) {
        const code = String(a?.code || "").trim();
        const outlet = String(a?.outlet || "").trim();
        const keys = Array.isArray(a?.productKeys) ? (a.productKeys as any[]).map((k: any) => String(k || "").trim()).filter(Boolean) : [];
        if (!code || !outlet) continue;
        for (const pk of keys) setOwner(outlet, pk, code);
      }
    } catch {}

    // 3) Pre-clear owners for any codes present in the incoming payload (treat payload as source of truth)
    const incomingCodes = new Set(Object.keys(incoming));
    if (incomingCodes.size > 0) {
      for (const [k, v] of Array.from(owners.entries())) {
        if (incomingCodes.has(v.ownerCode)) owners.delete(k);
      }
    }

    // 4) Validate uniqueness: a productKey can only be owned by one code per outlet
    type Conflict = { outlet: string; productKey: string; holderCode: string; incomingCode: string };
    const conflicts: Conflict[] = [];
    for (const [code, entry] of Object.entries(incoming)) {
      const outlet = entry.outlet;
      for (const pk of entry.productKeys) {
        const k = `${outlet}__${pk}`;
        const existing = owners.get(k);
        if (existing && existing.ownerCode !== code) {
          conflicts.push({ outlet, productKey: pk, holderCode: existing.ownerCode, incomingCode: code });
        } else {
          owners.set(k, { outlet, ownerCode: code });
        }
      }
    }

    if (conflicts.length > 0) {
      // Do not write anything; report conflicts for UI to resolve
      return NextResponse.json({ ok: false, error: "product_conflict", conflicts });
    }

    // 5) Apply changes
    let processed = 0;
    for (const [code, entry] of Object.entries(incoming)) {
      try {
        const { canonicalCode, before, after, changed } = await upsertAssignmentForCode(code, entry.outlet, entry.productKeys);
        processed += 1;
        if (changed) {
          await notifyAttendantAssignmentChange(canonicalCode, { before, after });
        }
      } catch (err) {
        console.error("save scope entry failed", code, err);
      }
    }

    return NextResponse.json({ ok: true, count: processed });
  } catch (e) {
    console.error("save scope error", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

// DELETE /api/admin/scope?code=<loginCode>
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const canonical = normalizeCode(searchParams.get("code") || "");
    if (!canonical) return NextResponse.json({ ok: false, error: "code required" }, { status: 400 });

    await prisma.attendantAssignment.delete({ where: { code: canonical } }).catch(() => {});
    await prisma.attendantScope.delete({ where: { codeNorm: canonical } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("delete scope error", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
