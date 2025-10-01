import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/codeNormalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type OutletInput = {
  id?: unknown;
  name?: unknown;
  code?: unknown;
  active?: unknown;
};

type SanitizedOutlet = {
  id?: string;
  name: string;
  canonicalCode: string | null;
  active: boolean;
};

function isCuid(value: string | undefined): boolean {
  if (!value) return false;
  return /^c[a-z0-9]{24}$/i.test(value);
}

function sanitizeOutlet(input: OutletInput): SanitizedOutlet | null {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return null;

  const rawCode = typeof input.code === "string" ? input.code.trim() : "";
  const canonical = rawCode ? normalizeCode(rawCode) : null;
  const id = typeof input.id === "string" && isCuid(input.id) ? input.id : undefined;
  const active = input.active === false ? false : true;

  return { id, name, canonicalCode: canonical, active };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const list = Array.isArray(body?.outlets) ? body.outlets : [];
    if (!Array.isArray(list) || list.length === 0) {
      return NextResponse.json({ ok: false, error: "No outlets provided" }, { status: 400 });
    }

    const sanitized: SanitizedOutlet[] = [];
    for (const item of list as OutletInput[]) {
      const clean = sanitizeOutlet(item);
      if (!clean) {
        const nameVal = typeof item?.name === "string" ? item.name : "";
        const msg = nameVal ? `Invalid outlet payload for ${nameVal}` : "Outlet name is required";
        return NextResponse.json({ ok: false, error: msg }, { status: 400 });
      }
      sanitized.push(clean);
    }

    const result = await (prisma as any).$transaction(async (tx: any) => {
      for (const entry of sanitized) {
        const where = entry.id ? { id: entry.id } : { name: entry.name };
        await tx.outlet.upsert({
          where,
          update: {
            name: entry.name,
            code: entry.canonicalCode,
            active: entry.active,
          },
          create: {
            name: entry.name,
            code: entry.canonicalCode,
            active: entry.active,
          },
        });
      }

      const latest = await tx.outlet.findMany({ orderBy: { name: "asc" } });
      await tx.setting.upsert({
        where: { key: "admin_outlets" },
        update: {
          value: latest.map((o: any) => ({
            id: o.id,
            name: o.name,
            code: typeof o.code === "string" ? o.code.toUpperCase() : "",
            active: o.active,
          })),
        },
        create: {
          key: "admin_outlets",
          value: latest.map((o: any) => ({
            id: o.id,
            name: o.name,
            code: typeof o.code === "string" ? o.code.toUpperCase() : "",
            active: o.active,
          })),
        },
      });

      return latest;
    });

    const normalized = result.map((o: any) => ({
      id: o.id,
      name: o.name,
      code: typeof o.code === "string" ? o.code.toUpperCase() : "",
      active: o.active,
    }));

    return NextResponse.json({ ok: true, outlets: normalized });
  } catch (e: any) {
    console.error("admin/outlets upsert error", e);
    const message = e?.message ? String(e.message) : "Server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
