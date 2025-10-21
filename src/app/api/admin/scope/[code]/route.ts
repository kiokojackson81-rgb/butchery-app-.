import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/codeNormalize";
import { notifyAttendantAssignmentChange, upsertAssignmentForCode } from "@/server/assignments";

type ScopeBody = { outlet?: string; productKeys?: unknown };

function sanitizeEntry(value: ScopeBody) {
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
  return { outlet, productKeys: keys } as { outlet: string; productKeys: string[] };
}

// PUT /api/admin/scope/[code]  -> upsert assignments for a single canonical code
export async function PUT(req: Request, { params }: { params: { code?: string } }) {
  try {
    const rawCode = params?.code || "";
    const canonical = normalizeCode(rawCode || "");
    if (!canonical) return NextResponse.json({ ok: false, error: "code required" }, { status: 400 });

    const body = (await req.json()) as ScopeBody;
    const entry = sanitizeEntry(body || {});
    if (!entry) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });

    try {
      const { canonicalCode, before, after, changed } = await upsertAssignmentForCode(canonical, entry.outlet, entry.productKeys);
      let notify: { sent: boolean; reason?: string } | undefined;
      try {
        notify = changed ? await notifyAttendantAssignmentChange(canonicalCode, { before, after }) : { sent: false, reason: "no-change" };
      } catch (e) {
        notify = { sent: false, reason: "notify-error" };
      }
      return NextResponse.json({ ok: true, code: canonicalCode, changed, notify });
    } catch (e) {
      console.error("upsert scope failed", canonical, e);
      return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 });
    }
  } catch (e) {
    console.error("scope put error", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

// DELETE /api/admin/scope/[code]
export async function DELETE(req: Request, { params }: { params: { code?: string } }) {
  try {
    const rawCode = params?.code || "";
    const canonical = normalizeCode(rawCode || "");
    if (!canonical) return NextResponse.json({ ok: false, error: "code required" }, { status: 400 });

    await prisma.attendantAssignment.deleteMany({ where: { code: canonical } }).catch(() => {});
    await prisma.attendantScope.deleteMany({ where: { codeNorm: canonical } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("delete scope error", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
