import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull, canonNum, normalizeCode } from "@/lib/codeNormalize";

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
    // If we cannot query the view (e.g., during dev or transient issues),
    // do not block the upsert but log in non-prod.
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const people: any[] = Array.isArray(body?.people)
      ? body.people
      : body && body.loginCode
        ? [body]
        : [];
    if (!Array.isArray(people) || people.length === 0) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    let count = 0;
    const keepCodes = new Map<string, PersonRole>();

    for (const p of people) {
      if (!p?.code && !p?.loginCode) continue;
      const codeRaw = String(p.code ?? p.loginCode);
      const codeFull = normalizeCode(codeRaw);
      if (!codeFull) continue;
      const role = asPersonRole(p?.role);
      const active = !!p?.active;

      keepCodes.set(codeFull, role);

      await ensureNoDigitCollision(codeRaw).catch((e: any) => { throw e; });

      try {
        await (prisma as any).personCode.upsert({
          where: { code: codeFull },
          update: { name: p?.name || "", role, active },
          create: { code: codeFull, name: p?.name || "", role, active },
        });
      } catch {}

      if (role === "attendant") {
        let outletId: string | undefined;
        if (p?.outlet) {
          const out = await (prisma as any).outlet.upsert({
            where: { name: p.outlet },
            update: {},
            create: { name: p.outlet, code: canonFull(p.outlet), active: true },
          }).catch(() => null);
          outletId = out?.id;
        }

        let attId: string | undefined;
        try {
          const existing = await (prisma as any).attendant.findFirst({
            where: { loginCode: { equals: codeFull, mode: "insensitive" } },
          });
          attId = existing?.id;
          if (existing) {
            const updated = await (prisma as any).attendant.update({
              where: { id: existing.id },
              data: { name: p?.name || existing.name, outletId },
            });
            attId = updated?.id;
          } else {
            const created = await (prisma as any).attendant.create({
              data: { name: p?.name || "Attendant", loginCode: codeFull, outletId },
            }).catch(() => null);
            attId = created?.id;
          }
        } catch {}

        if (attId) {
          try {
            await (prisma as any).loginCode.upsert({
              where: { code: codeFull },
              update: { attendantId: attId, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
              create: { code: codeFull, attendantId: attId, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
            });
          } catch {}
        }
      }

      if (role === "supervisor") {
        try {
          await (prisma as any).supervisor.upsert({
            where: { code: codeFull },
            update: { active },
            create: { code: codeFull, active },
          });
        } catch {}
      }
      if (role === "supplier") {
        try {
          await (prisma as any).supplier.upsert({
            where: { code: codeFull },
            update: { active },
            create: { code: codeFull, active },
          });
        } catch {}
      }

      count++;
    }

    let deleted = 0;
    try {
      const existing = await (prisma as any).personCode.findMany({
        select: { code: true, role: true },
      });
      const toRemove: Array<{ canonical: string; role: PersonRole }> = [];
      if (Array.isArray(existing)) {
        for (const row of existing) {
          const canonical = normalizeCode(row?.code || "");
          if (!canonical || keepCodes.has(canonical)) continue;
          toRemove.push({ canonical, role: asPersonRole(row?.role) });
        }
      }
      for (const entry of toRemove) {
        const removed = await removeCodeCascade(entry.canonical, entry.role).catch((err) => {
          console.error("remove code cascade failed", entry.canonical, err);
          return false;
        });
        if (removed) deleted += 1;
      }
    } catch (err) {
      console.error("failed to evaluate code deletions", err);
    }

    await (prisma as any).setting.upsert({
      where: { key: "admin_codes" },
      update: { value: people },
      create: { key: "admin_codes", value: people },
    });

    return NextResponse.json({ ok: true, count, deleted });
  } catch (e: any) {
    const msg = String(e?.message || "Failed");
    const isCollision = /Digit-core collision/i.test(msg);
    return NextResponse.json({ ok: false, error: msg }, { status: isCollision ? 409 : 500 });
  }
}
