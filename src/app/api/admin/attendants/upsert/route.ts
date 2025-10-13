import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull, canonNum, normalizeCode } from "@/lib/codeNormalize";
import { sendTemplate } from "@/lib/wa";
import { WA_TEMPLATES } from "@/server/wa/templates";
import { getLoginLinkFor } from "@/server/wa_links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PersonRole = "attendant" | "supervisor" | "supplier";

function asPersonRole(value: unknown): PersonRole {
  const lower = String(value || "").toLowerCase();
  if (lower === "supervisor" || lower === "supplier") return lower;
  return "attendant";
}

async function ensureNoDigitCollision(code: string) {
  const num = canonNum(code);
  if (!num) return;
  const full = canonFull(code);
  let rows: any[] = [];
  try {
    rows = await (prisma as any).$queryRaw`
      SELECT raw_code, canon_code
      FROM "vw_codes_norm"
      WHERE canon_num = ${num}
    `;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("ensureNoDigitCollision: query failed; skipping check", err);
    }
    return;
  }
  const conflicts = Array.isArray(rows)
    ? rows.filter((r: any) => (r?.canon_code || "") !== full)
    : [];
  if (conflicts.length > 0) {
    const list = conflicts.map((c: any) => c?.raw_code || c?.canon_code || "?");
    throw new Error(`Digit-core collision with existing code(s): ${list.join(', ')}`);
  }
}

async function removeCodeCascade(rawCode: string, role: PersonRole): Promise<boolean> {
  const canonical = normalizeCode(rawCode || "");
  if (!canonical) return false;
  const client = prisma as any;

  try { await client.phoneMapping.deleteMany({ where: { code: canonical } }); } catch {}
  try {
    await client.waSession.updateMany({
      where: { code: canonical },
      data: { code: null, state: "IDLE", cursor: null },
    });
  } catch {}

  if (role === "attendant") {
    let attendant: any = null;
    try {
      attendant = await client.attendant.findFirst({
        where: { loginCode: { equals: canonical, mode: "insensitive" } },
      });
    } catch {}
    const attId: string | undefined = attendant?.id;
    if (attId) {
      try { await client.session.deleteMany({ where: { attendantId: attId } }); } catch {}
      try { await client.loginCode.deleteMany({ where: { attendantId: attId } }); } catch {}
      try {
        await client.waMessageLog.updateMany({
          where: { attendantId: attId },
          data: { attendantId: null },
        });
      } catch {}
      try { await client.attendant.delete({ where: { id: attId } }); } catch {}
    } else {
      try {
        await client.loginCode.deleteMany({
          where: { code: { equals: canonical, mode: "insensitive" } },
        });
      } catch {}
    }
    try { await client.attendantAssignment.deleteMany({ where: { code: canonical } }); } catch {}
    try { await client.attendantScope.deleteMany({ where: { codeNorm: canonical } }); } catch {}
  } else if (role === "supervisor") {
    try {
      if (client.supervisor?.deleteMany) {
        await client.supervisor.deleteMany({ where: { code: canonical } });
      } else if (client.supervisor?.delete) {
        await client.supervisor.delete({ where: { code: canonical } });
      } else if (client.$executeRaw) {
        await client.$executeRaw`DELETE FROM "Supervisor" WHERE code = ${canonical}`;
      }
    } catch {}
  } else if (role === "supplier") {
    try {
      if (client.supplier?.deleteMany) {
        await client.supplier.deleteMany({ where: { code: canonical } });
      } else if (client.supplier?.delete) {
        await client.supplier.delete({ where: { code: canonical } });
      } else if (client.$executeRaw) {
        await client.$executeRaw`DELETE FROM "Supplier" WHERE code = ${canonical}`;
      }
    } catch {}
  }

  try {
    const res = await client.personCode.delete({ where: { code: canonical } });
    return !!res;
  } catch {
    return false;
  }
}

type CleanPerson = {
  canonical: string;
  rawCode: string;
  role: PersonRole;
  name: string;
  active: boolean;
  outlet?: string;
  salaryAmount?: number;
  salaryFrequency?: "daily" | "weekly" | "monthly";
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const incoming: any[] = Array.isArray(body?.people)
      ? body.people
      : body && body.loginCode
        ? [body]
        : [];
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const orderedCanonicals: string[] = [];
    const cleanByCode = new Map<string, CleanPerson>();

    for (const p of incoming) {
      const codeSource = typeof p?.code === "string" ? p.code : typeof p?.loginCode === "string" ? p.loginCode : "";
      const rawCode = String(codeSource || "").trim();
      const canonical = normalizeCode(rawCode);
      if (!canonical) continue;

      const record: CleanPerson = {
        canonical,
        rawCode,
        role: asPersonRole(p?.role),
        name: typeof p?.name === "string" ? p.name.trim() : "",
        active: p?.active !== false,
        outlet: typeof p?.outlet === "string" ? p.outlet.trim() || undefined : undefined,
        salaryAmount: Number.isFinite(p?.salaryAmount) ? Number(p?.salaryAmount) : undefined,
        salaryFrequency: typeof p?.salaryFrequency === "string" ? ((): any => {
          const f = String(p?.salaryFrequency || "").toLowerCase();
          return f === "weekly" || f === "monthly" ? f : f === "daily" ? "daily" : undefined;
        })() : undefined,
      };

      cleanByCode.set(canonical, record);
      orderedCanonicals.push(canonical);
    }

    if (cleanByCode.size === 0) {
      return NextResponse.json({ ok: false, error: "No valid codes to save" }, { status: 400 });
    }

    const seen = new Set<string>();
    const canonicalOrder: string[] = [];
    for (const code of orderedCanonicals) {
      if (seen.has(code)) continue;
      if (!cleanByCode.has(code)) continue;
      seen.add(code);
      canonicalOrder.push(code);
    }

    const sanitizedPayload = canonicalOrder.map((code) => {
      const entry = cleanByCode.get(code)!;
      const base: Record<string, unknown> = {
        role: entry.role,
        code: entry.rawCode,
        name: entry.name,
        active: entry.active,
      };
      if (entry.outlet) base.outlet = entry.outlet;
      if (entry.role === "attendant") {
        if (typeof entry.salaryAmount === "number") base.salaryAmount = entry.salaryAmount;
        if (entry.salaryFrequency) base.salaryFrequency = entry.salaryFrequency;
      }
      return base;
    });

    const existingRows = await (prisma as any).personCode.findMany({
      select: { id: true, code: true, role: true },
    });
    const previousByCode = new Map<string, { id: string; role: PersonRole }>();
    for (const row of existingRows) {
      const canonical = normalizeCode((row as any)?.code ?? "");
      if (!canonical) continue;
      const role = asPersonRole((row as any)?.role);
      previousByCode.set(canonical, { id: (row as any).id, role });
    }

  let count = 0;
  const roleRemovalEvents: Array<{ code: string; role: PersonRole; outlet?: string }> = [];
    for (const code of canonicalOrder) {
      const entry = cleanByCode.get(code)!;
      await ensureNoDigitCollision(entry.rawCode);

      const existing = previousByCode.get(code);
      if (existing) previousByCode.delete(code);

      try {
        if (existing) {
          await (prisma as any).personCode.update({
            where: { id: existing.id },
            data: { code, name: entry.name, role: entry.role, active: entry.active },
          });
        } else {
          await (prisma as any).personCode.create({
            data: { code, name: entry.name, role: entry.role, active: entry.active },
          });
        }
      } catch {}

      if (entry.role === "attendant") {
        let outletId: string | undefined;
        if (entry.outlet) {
          const out = await (prisma as any).outlet.upsert({
            where: { name: entry.outlet },
            update: {},
            create: { name: entry.outlet, code: canonFull(entry.outlet), active: true },
          }).catch(() => null);
          outletId = out?.id;
        }

        let attId: string | undefined;
        try {
          const existing = await (prisma as any).attendant.findFirst({
            where: { loginCode: { equals: code, mode: "insensitive" } },
          });
          attId = existing?.id;
          if (existing) {
            const updated = await (prisma as any).attendant.update({
              where: { id: existing.id },
              data: {
                name: entry.name || existing.name,
                outletId,
                ...(typeof entry.salaryAmount === "number" ? { salaryAmount: entry.salaryAmount } : {}),
                ...(entry.salaryFrequency ? { salaryFrequency: entry.salaryFrequency } : {}),
              },
            });
            attId = updated?.id;
          } else {
            const created = await (prisma as any).attendant.create({
              data: {
                name: entry.name || "Attendant",
                loginCode: code,
                outletId,
                salaryAmount: typeof entry.salaryAmount === "number" ? entry.salaryAmount : 0,
                salaryFrequency: entry.salaryFrequency ?? "daily",
              },
            }).catch(() => null);
            attId = created?.id;
          }
        } catch {}

        if (attId) {
          try {
            await (prisma as any).loginCode.upsert({
              where: { code },
              update: { attendantId: attId, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
              create: { code, attendantId: attId, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
            });
          } catch {}
        }
      }

      if (entry.role === "supervisor") {
        try {
          await (prisma as any).supervisor.upsert({
            where: { code },
            update: { active: entry.active },
            create: { code, active: entry.active },
          });
        } catch {}
      }

      if (entry.role === "supplier") {
        try {
          await (prisma as any).supplier.upsert({
            where: { code },
            update: { active: entry.active },
            create: { code, active: entry.active },
          });
        } catch {}
      }

      count += 1;
    }

    const toDelete: Array<{ canonical: string; role: PersonRole }> = [];
    for (const [canonical, meta] of previousByCode.entries()) {
      if (!cleanByCode.has(canonical)) {
        toDelete.push({ canonical, role: meta.role });
      }
    }

    let deleted = 0;
    for (const entry of toDelete) {
      const removed = await removeCodeCascade(entry.canonical, entry.role).catch((err) => {
        console.error("remove code cascade failed", entry.canonical, err);
        return false;
      });
      if (removed) deleted += 1;
      if (removed) roleRemovalEvents.push({ code: entry.canonical, role: entry.role });
    }

    await (prisma as any).setting.upsert({
      where: { key: "admin_codes" },
      update: { value: sanitizedPayload },
      create: { key: "admin_codes", value: sanitizedPayload },
    });

    // Fire assignment/role-removed notifications (best-effort)
    try {
      const APP_ORIGIN = process.env.APP_ORIGIN || "";
      // Notify attendants about assignment changes using template
      for (const code of canonicalOrder) {
        const pc = await (prisma as any).personCode.findFirst({ where: { code } }).catch(() => null);
        const role = String(pc?.role || "attendant").toLowerCase() as PersonRole;
        const pm = await (prisma as any).phoneMapping.findUnique({ where: { code } }).catch(() => null);
        const phone = pm?.phoneE164 as string | undefined;
        if (!phone) continue;
        if (role === "attendant") {
          const sc = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: code }, include: { products: true } }).catch(() => null);
          const outlet = sc?.outletName || "";
          const keys: string[] = Array.isArray(sc?.products) ? sc.products.map((p: any) => p?.productKey).filter(Boolean) : [];
          const rows = await (prisma as any).product.findMany({ where: { key: { in: keys } }, select: { key: true, name: true } }).catch(() => []);
          const nameByKey = new Map<string, string>();
          for (const r of rows as any[]) nameByKey.set(r.key, r.name || r.key);
          const products = keys.map((k) => nameByKey.get(k) ?? k).join(", ") || "no products";
          const link = APP_ORIGIN ? `${APP_ORIGIN}/login` : (await getLoginLinkFor(phone));
          try { await sendTemplate({ to: phone, template: WA_TEMPLATES.attendantAssignment, params: [outlet, products, link], contextType: "ASSIGNMENT" }); } catch {}
        } else if (role === "supervisor") {
          const outlet = (await (prisma as any).attendantAssignment.findUnique({ where: { code } }).catch(() => null))?.outlet || "";
          const link = APP_ORIGIN ? `${APP_ORIGIN}/login` : (await getLoginLinkFor(phone));
          try { await sendTemplate({ to: phone, template: WA_TEMPLATES.supervisorAssignment, params: [outlet, link], contextType: "ASSIGNMENT" }); } catch {}
        } else if (role === "supplier") {
          const outlet = (await (prisma as any).attendantAssignment.findUnique({ where: { code } }).catch(() => null))?.outlet || "";
          const link = APP_ORIGIN ? `${APP_ORIGIN}/login` : (await getLoginLinkFor(phone));
          try { await sendTemplate({ to: phone, template: WA_TEMPLATES.supplierAssignment, params: [outlet, link], contextType: "ASSIGNMENT" }); } catch {}
        }
      }

      // Role removal notices
      for (const ev of roleRemovalEvents) {
        const pm = await (prisma as any).phoneMapping.findUnique({ where: { code: ev.code } }).catch(() => null);
        const phone = pm?.phoneE164 as string | undefined; if (!phone) continue;
        const outlet = ev.outlet || "";
        const roleLabel = ev.role === "attendant" ? "Attendant" : ev.role === "supervisor" ? "Supervisor" : "Supplier";
  try { await sendTemplate({ to: phone, template: WA_TEMPLATES.roleRemoved, params: [roleLabel, outlet], contextType: "ASSIGNMENT" }); } catch {}
      }
    } catch {}

    return NextResponse.json({ ok: true, count, deleted });
  } catch (e: any) {
    const msg = String(e?.message || "Failed");
    const isCollision = /Digit-core collision/i.test(msg);
    return NextResponse.json({ ok: false, error: msg }, { status: isCollision ? 409 : 500 });
  }
}
