import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/codeNormalize";
import { getAssignmentSnapshot, notifyAttendantAssignmentChange, upsertAssignmentForCode } from "@/server/assignments";

type Body = {
  outlet: string;
  productKey: string;
  toCode: string; // target owner
  fromCode?: string; // optional hint; server will resolve authoritative owner
};

export async function PUT(req: Request) {
  try {
    const { outlet, productKey, toCode, fromCode }: Body = await req.json();
    const outletName = typeof outlet === "string" ? outlet.trim() : "";
    const key = typeof productKey === "string" ? productKey.trim() : "";
    const to = normalizeCode(typeof toCode === "string" ? toCode : "");
    if (!outletName || !key || !to) {
      return NextResponse.json({ ok: false, error: "outlet, productKey and toCode are required" }, { status: 400 });
    }

    // Find current owner for this outlet/product
    let currentOwner: string | null = null;
    // Prefer normalized scope table
    try {
      const scopes = await (prisma as any).attendantScope.findMany({ where: { outletName }, include: { products: true } });
      for (const s of (scopes || []) as any[]) {
        const codeNorm = String(s?.codeNorm || "").trim();
        if (!codeNorm) continue;
        const has = Array.isArray(s?.products) && (s.products as any[]).some((p: any) => String(p?.productKey || "") === key);
        if (has) { currentOwner = codeNorm; break; }
      }
    } catch {}

    // Fallback to legacy assignment if not found
    if (!currentOwner) {
      try {
        const assigns = await (prisma as any).attendantAssignment.findMany({ where: { outlet: outletName } });
        for (const a of (assigns || []) as any[]) {
          const code = normalizeCode(String(a?.code || ""));
          const list = Array.isArray(a?.productKeys) ? (a.productKeys as any[]).map((x: any) => String(x || "").trim()) : [];
          if (code && list.includes(key)) { currentOwner = code; break; }
        }
      } catch {}
    }

    // If fromCode hint provided and disagrees with resolved owner, we still proceed with resolved owner
    const from = currentOwner;

    if (from === to) {
      // Already assigned to target; ensure outlet binding and presence of the key for idempotency
      const toSnap = await getAssignmentSnapshot(to);
      const newKeys = Array.from(new Set([...(toSnap.productKeys || []), key])).sort();
      await upsertAssignmentForCode(to, outletName, newKeys);
      return NextResponse.json({ ok: true, changed: false, reason: "already-owned" });
    }

    // Apply atomic reassignment: remove from previous owner (if any), add to target
    // Gather snapshots
    const toSnap = await getAssignmentSnapshot(to);
    const fromSnap = from ? await getAssignmentSnapshot(from) : null;

    // Build new key sets
    const toKeys = Array.from(new Set([...(toSnap.productKeys || []), key])).sort();
    const fromKeys = fromSnap ? (fromSnap.productKeys || []).filter((k) => k !== key) : null;

    // Write-through in a transaction-like manner; upsertAssignmentForCode already uses $transaction internally per code
    await upsertAssignmentForCode(to, outletName, toKeys);
    if (from && fromKeys) {
      await upsertAssignmentForCode(from, fromSnap?.outlet || outletName, fromKeys);
    }

    // Notify the new owner (optional: could also notify the previous owner)
    try { await notifyAttendantAssignmentChange(to); } catch {}

    return NextResponse.json({ ok: true, reassigned: { outlet: outletName, productKey: key, from: from || null, to } });
  } catch (e: any) {
    console.error("scope.reassign error", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
