import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/codeNormalize";

type AssignmentShape = { outlet: string; productKeys: string[] } | null;

type ScopeEntry = { outlet?: unknown; productKeys?: unknown };

type LegacyOutlet = { code?: unknown; name?: unknown; active?: unknown };

type LegacyProduct = { key?: unknown; active?: unknown };

type LegacyPricebook = Record<string, Record<string, { active?: unknown }>>;

function toProductKeys(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const key = value.trim();
    if (key.length === 0) continue;
    set.add(key);
  }
  return Array.from(set);
}

async function resolveOutletName(outlet: string): Promise<string> {
  const row = await (prisma as any).outlet.findFirst({
    where: { name: { equals: outlet, mode: "insensitive" } },
    select: { name: true },
  });
  return row?.name || outlet;
}

async function hydrateFromScope(norm: string): Promise<AssignmentShape> {
  const scopeRow = await (prisma as any).setting.findUnique({ where: { key: "attendant_scope" } });
  const scopeMap = scopeRow && typeof (scopeRow as any).value === "object" && (scopeRow as any).value !== null
    ? (scopeRow as any).value as Record<string, ScopeEntry>
    : undefined;
  const entry = scopeMap?.[norm];
  if (!entry || typeof entry?.outlet !== "string") return null;

  const outletRaw = entry.outlet.trim();
  if (!outletRaw) return null;
  const outletName = await resolveOutletName(outletRaw);
  const productKeys = toProductKeys(entry.productKeys);

  await (prisma as any).attendantAssignment.upsert({
    where: { code: norm },
    update: { outlet: outletName, productKeys },
    create: { code: norm, outlet: outletName, productKeys },
  });

  return { outlet: outletName, productKeys };
}

async function hydrateFromLegacy(norm: string): Promise<AssignmentShape> {
  const outletsRow = await (prisma as any).setting.findUnique({ where: { key: "admin_outlets" } });
  const productsRow = await (prisma as any).setting.findUnique({ where: { key: "admin_products" } });
  const pricebookRow = await (prisma as any).setting.findUnique({ where: { key: "admin_pricebook" } });
  const outlets = Array.isArray((outletsRow as any)?.value) ? ((outletsRow as any).value as LegacyOutlet[]) : [];
  const products = Array.isArray((productsRow as any)?.value) ? ((productsRow as any).value as LegacyProduct[]) : [];
  const pbMap = pricebookRow && typeof (pricebookRow as any).value === "object" && (pricebookRow as any).value !== null
    ? ((pricebookRow as any).value as LegacyPricebook)
    : {};

  const outletHit = outlets.find((o) => {
    if (!o) return false;
    if (o.active !== true) return false;
    const codeRaw = typeof o.code === "string" ? o.code : "";
    return normalizeCode(codeRaw) === norm;
  });

  if (!outletHit || typeof outletHit.name !== "string") return null;
  const outletName = await resolveOutletName(outletHit.name);

  const activeGlobalKeys = products.filter((p) => p?.active === true && typeof p?.key === "string").map((p) => String(p.key));
  const keySet = new Set<string>(activeGlobalKeys);
  const outletPB = pbMap?.[outletName] || {};
  for (const [key, meta] of Object.entries(outletPB)) {
    if (meta?.active === false) keySet.delete(key);
  }
  const productKeys = Array.from(keySet);

  await (prisma as any).attendantAssignment.upsert({
    where: { code: norm },
    update: { outlet: outletName, productKeys },
    create: { code: norm, outlet: outletName, productKeys },
  });

  return { outlet: outletName, productKeys };
}

async function getAssignment(norm: string): Promise<AssignmentShape> {
  const direct = await (prisma as any).attendantAssignment.findUnique({ where: { code: norm } });
  if (direct?.outlet) {
    return {
      outlet: direct.outlet,
      productKeys: toProductKeys((direct as any).productKeys),
    };
  }

  const scoped = await hydrateFromScope(norm);
  if (scoped) return scoped;

  return hydrateFromLegacy(norm);
}

function isExpired(row: any): boolean {
  if (!row?.expiresAt) return false;
  try {
    const expiry = new Date(row.expiresAt as string | number | Date);
    return Number.isFinite(expiry.valueOf()) && expiry.valueOf() < Date.now();
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ ok: false, error: "Code required" }, { status: 400 });
    }

    const norm = normalizeCode(code);
    if (!norm) {
      return NextResponse.json({ ok: false, error: "Code required" }, { status: 400 });
    }

    const loginRow = await (prisma as any).loginCode.findUnique({ where: { code: norm } }).catch(() => null);
    if (!loginRow) {
      return NextResponse.json({ ok: false, error: "Code not found" }, { status: 404 });
    }
    if (isExpired(loginRow)) {
      return NextResponse.json({ ok: false, error: "Code expired" }, { status: 410 });
    }

    const assignment = await getAssignment(norm);
    if (!assignment || !assignment.outlet) {
      return NextResponse.json({ ok: false, error: "Code not assigned to outlet" }, { status: 422 });
    }

    return NextResponse.json({ ok: true, outlet: assignment.outlet, productKeys: assignment.productKeys });
  } catch (e) {
    console.error("attendant login error", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
