import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/codeNormalize";

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
      ))
    : [];
  return { outlet, productKeys: keys };
}

async function resolveOutletName(outlet: string): Promise<string> {
  const row = await (prisma as any).outlet.findFirst({
    where: { name: { equals: outlet, mode: "insensitive" } },
    select: { name: true },
  });
  return row?.name || outlet;
}

async function upsertAssignment(code: string, entry: ScopeEntry) {
  const normalized = normalizeCode(code);
  if (!normalized) return;
  const outletName = await resolveOutletName(entry.outlet);
  await (prisma as any).attendantAssignment.upsert({
    where: { code: normalized },
    update: { outlet: outletName, productKeys: entry.productKeys },
    create: { code: normalized, outlet: outletName, productKeys: entry.productKeys },
  });
}

/**
 * Body shape:
 * {
 *   "<normalizedCode>": { outlet: "Baraka A", productKeys: ["beef","goat"] },
 *   ...
 * }
 */
export async function POST(req: Request) {
  try {
    const scope = (await req.json()) as ScopePayload;
    if (!scope || typeof scope !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const entries = Object.entries(scope);
    await Promise.all(
      entries.map(async ([code, raw]) => {
        const entry = sanitizeEntry(raw || {});
        if (!entry) return;
        await upsertAssignment(code, entry);
      })
    );

    return NextResponse.json({ ok: true, count: entries.length });
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

    await (prisma as any).attendantAssignment.delete({ where: { code: canonical } }).catch(() => {});
    // Also clear normalized scope if stored in AttendantScope
    await (prisma as any).attendantScope.delete({ where: { codeNorm: canonical } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
