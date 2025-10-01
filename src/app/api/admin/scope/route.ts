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

    let processed = 0;

    for (const [code, raw] of Object.entries(scope)) {
      const entry = sanitizeEntry(raw || {});
      if (!entry) continue;
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
