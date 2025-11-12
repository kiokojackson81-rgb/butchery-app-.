import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { normalizeCode, canonNum, canonFull, canonLoose } from "@/lib/codeNormalize";
import { createSession, serializeSessionCookie } from "@/lib/session";
import { serializeRoleCookie } from "@/lib/roleSession";
import { randomUUID } from "crypto";
import { isGeneralDepositAttendant } from "@/server/general_deposit";

async function ensureLoginProvision(loginCode: string, roleHint: "attendant" | "assistant" = "attendant") {
  const code = canonLoose(loginCode || "");
  if (!code) return null;

  const existing = await (prisma as any).loginCode.findUnique({ where: { code } }).catch(() => null);

  // Try both normalized scope and legacy assignment
  const [assignment, scope] = await Promise.all([
    (prisma as any).attendantAssignment.findUnique({ where: { code } }).catch(() => null),
    (prisma as any).attendantScope.findFirst({ where: { codeNorm: code } }).catch(() => null),
  ]);

  // Fallback: consult admin_codes Setting (active attendant/assistant records)
  let fallbackOutlet: string | null = null;
  let fallbackRole: "attendant" | "assistant" | null = null;
  if (!assignment && !scope) {
    try {
      // 3a) Prefer the structured scope mirror if present (admin UI writes Setting 'attendant_scope').
      //     This helps when assignments were saved locally/mirrored but relational sync hasn't run yet.
      try {
        const scopeRow = await (prisma as any).setting.findUnique({ where: { key: "attendant_scope" } });
        const obj = (scopeRow as any)?.value || null;
        if (obj && typeof obj === "object") {
          // Try direct lookups first
          let fromMirror: any = (obj as any)[code]
            || (obj as any)[normalizeCode(loginCode || "")]
            || (obj as any)[canonFull(loginCode || "")]
            || (obj as any)[canonLoose(loginCode || "")]
            || null;
          // If not found, iterate keys and compare normalized forms
          if (!fromMirror) {
            for (const k of Object.keys(obj)) {
              const kn = normalizeCode(k);
              const kl = canonLoose(k);
              if (kn === code || kl === code) { fromMirror = (obj as any)[k]; break; }
            }
          }
          const outlet = String((fromMirror?.outlet as any) || "").trim();
          if (outlet) fallbackOutlet = outlet;
        }
      } catch {}

      const settingsRow = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
      const list: any[] = Array.isArray((settingsRow as any)?.value) ? (settingsRow as any).value : [];
      const allowedRoles = new Set(["attendant", "assistant"]);
      const staff = list.filter(
        (p: any) => !!p?.active && allowedRoles.has(String(p?.role || "").toLowerCase())
      );
      const selected = staff.find((p: any) => normalizeCode(p?.code || "") === code);
      if (!fallbackOutlet && selected?.outlet) fallbackOutlet = String(selected.outlet);
      if (!fallbackRole && selected?.role) {
        const r = String(selected.role).toLowerCase();
        if (r === "assistant") fallbackRole = "assistant";
        else if (r === "attendant") fallbackRole = "attendant";
      }
    } catch {}
  }
  if (!assignment && !scope && !fallbackOutlet && !existing) return null;

  const person = await (prisma as any).personCode.findUnique({ where: { code } }).catch(() => null);
  let desiredRole: "attendant" | "assistant" = roleHint;
  if (!person && fallbackRole) desiredRole = fallbackRole;
  if (person) {
    const existingRole = String(person.role || "").toLowerCase();
    if (existingRole === "assistant") desiredRole = "assistant";
    else if (existingRole === "attendant" && desiredRole !== "assistant") desiredRole = "attendant";
  }
  let outletRow = null;
  const outletName: string | null =
    (assignment as any)?.outlet || (scope as any)?.outletName || fallbackOutlet || null;
  if (outletName) {
    outletRow = await (prisma as any).outlet.findFirst({
      where: { name: { equals: outletName, mode: "insensitive" } },
    }).catch(() => null);
    if (!outletRow) {
      try {
        outletRow = await (prisma as any).outlet.create({
          data: { name: outletName, code: canonFull(outletName), active: true },
        });
      } catch {}
    }
  }

  // Robust attendant provisioning with fallback for older DBs lacking new columns
  let attendant = await (prisma as any).attendant
    .upsert({
      where: { loginCode: code },
      update: { outletId: outletRow?.id ?? null },
      create: {
        name: person?.name || outletName || code,
        loginCode: code,
        outletId: outletRow?.id ?? null,
      },
      select: { id: true, outletId: true, loginCode: true, name: true },
    })
    .catch(async (err: any) => {
      // If Prisma upsert fails due to schema drift (e.g., missing salaryAmount), do a raw SQL upsert
      try {
        const desiredName = person?.name || outletName || code;
        const desiredOutletId = outletRow?.id ?? null;
        const newId = randomUUID();
        // Try to update if exists
        const existing: any = await (prisma as any).$queryRaw`
          SELECT id, "loginCode", "outletId", name FROM "Attendant" WHERE "loginCode" = ${code} LIMIT 1
        `;
        if (Array.isArray(existing) && existing.length > 0) {
          const row = existing[0];
          if (!row.outletId && desiredOutletId) {
            await (prisma as any).$executeRaw`
              UPDATE "Attendant" SET "outletId" = ${desiredOutletId} WHERE id = ${row.id}
            `;
          }
        } else {
          // Insert minimal columns only (avoid referencing new columns that may not exist yet)
          await (prisma as any).$executeRaw`
            INSERT INTO "Attendant" ("id", "name", "loginCode", "outletId", "createdAt", "updatedAt")
            VALUES (${newId}, ${desiredName}, ${code}, ${desiredOutletId}, NOW(), NOW())
            ON CONFLICT ("loginCode") DO UPDATE SET 
              "outletId" = COALESCE("Attendant"."outletId", EXCLUDED."outletId"),
              "updatedAt" = NOW()
          `;
        }
        // Re-fetch
        const refetched: any = await (prisma as any).$queryRaw`
          SELECT id, "loginCode", "outletId", name FROM "Attendant" WHERE "loginCode" = ${code} LIMIT 1
        `;
        return Array.isArray(refetched) && refetched.length > 0 ? refetched[0] : null;
      } catch (e) {
        // Last resort: try normal findFirst once more
        return await (prisma as any).attendant.findFirst({
          where: { loginCode: { equals: code, mode: "insensitive" } },
          select: { id: true, outletId: true, loginCode: true, name: true },
        }).catch(() => null);
      }
    });

  const attendantId = attendant?.id;
  if (!attendantId) return existing;

  if (!person) {
    await (prisma as any).personCode.create({
      data: { code, role: desiredRole, name: attendant.name, active: true },
    }).catch(() => null);
  } else {
    const updates: Record<string, any> = {};
    if (String(person.role || "").toLowerCase() !== desiredRole) updates.role = desiredRole;
    if (person.active === false) updates.active = true;
    if (Object.keys(updates).length > 0) {
      await (prisma as any).personCode.update({
        where: { id: person.id },
        data: updates,
      }).catch(() => null);
    }
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const login = await (prisma as any).loginCode.upsert({
    where: { code },
    update: { attendantId, expiresAt },
    create: { code, attendantId, expiresAt },
  }).catch(() => null);

  return login;
}

function prismaIsSchemaError(err: any) {
  // PrismaKnownRequestError uses `code` like 'P2021' for missing table
  try {
    if (!err) return false;
    const code = err.code || (err?.meta && err.meta.code) || null;
    return String(code) === 'P2021';
  } catch (_) {
    return false;
  }
}

async function detectRoleForCode(loginCode: string): Promise<"attendant" | "assistant"> {
  const full = canonFull(loginCode || "");
  if (!full) return "attendant";
  const norm = normalizeCode(full);

  try {
    const person = await (prisma as any).personCode.findUnique({ where: { code: full }, select: { role: true, active: true } });
    const existingRole = String(person?.role || "").toLowerCase();
    if (person && person.active !== false) {
      if (existingRole === "assistant") return "assistant";
      if (existingRole === "attendant") return "attendant";
    }
  } catch {}

  try {
    const settingsRow = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
    const list: any[] = Array.isArray((settingsRow as any)?.value) ? (settingsRow as any).value : [];
    const match = list.find((entry: any) => normalizeCode(entry?.code || "") === norm);
    if (match && match.role) {
      const r = String(match.role).toLowerCase();
      if (r === "assistant") return "assistant";
      if (r === "attendant") return "attendant";
    }
  } catch {}

  try {
    if (await isGeneralDepositAttendant(full)) return "assistant";
  } catch {}

  return "attendant";
}

export async function POST(req: Request) {
  try {
    if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) {
      return NextResponse.json({ ok: false, error: "DB_NOT_CONFIGURED" }, { status: 503 });
    }
    const { loginCode } = (await req.json().catch(() => ({}))) as { loginCode?: string };
  const full = normalizeCode(loginCode || "");
  const loose = canonLoose(loginCode || "");
  const num = canonNum(loginCode || "");

    if (!full && !num) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
    }

  // 1) Try full canonical match in LoginCode (normalized), then loose if different
  let row: any = null;
  try {
    row = await (prisma as any).loginCode.findFirst({ where: { code: full } });
    if (!row && loose && loose !== full) {
      row = await (prisma as any).loginCode.findFirst({ where: { code: loose } });
    }
  } catch (err) {
    console.error("loginCode lookup failed", err);
    if (prismaIsSchemaError(err)) {
      return NextResponse.json({ ok: false, error: "DB_SCHEMA_MISSING" }, { status: 503 });
    }
  }

    if (!row && (loose || full)) {
      // Prefer loose (punctuation-stripped) for provisioning to tolerate typos like trailing '/'
      const candidate = loose || full;
      const roleGuess = await detectRoleForCode(candidate);
      row = await ensureLoginProvision(candidate, roleGuess);
    }

    // 2) Fallback to digits-only if unique
  if (!row && num) {
      try {
        // Compare as text using a parameterized query to avoid type errors and SQL injection
        const list: any[] = await (prisma as any).$queryRaw`
          SELECT * FROM "LoginCode"
          WHERE regexp_replace(code, '\\D', '', 'g') = ${num}
          LIMIT 3
        `;
        if (list.length === 1) {
          row = list[0];
        } else if (list.length > 1) {
          return NextResponse.json({ ok: false, error: "AMBIGUOUS_CODE" }, { status: 409 });
        } else {
          const assignments: any[] = await (prisma as any).$queryRaw`
            SELECT code FROM "AttendantAssignment"
            WHERE regexp_replace(code, '\\D', '', 'g') = ${num}
            LIMIT 3
          `;
          if (assignments.length === 1) {
            const candidate = assignments[0]?.code || '';
            const roleGuess = await detectRoleForCode(candidate);
            row = await ensureLoginProvision(candidate, roleGuess);
          } else if (assignments.length > 1) {
            return NextResponse.json({ ok: false, error: "AMBIGUOUS_CODE" }, { status: 409 });
          }
        }
      } catch (err) {
        console.error('digits fallback query failed', err);
        // continue to admin_codes fallback rather than throwing 500
      }
    }

    // 3) As a last resort, check admin_codes for an active attendant with an outlet and provision
    if (!row) {
      try {
        const settingsRow = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
        const list: any[] = Array.isArray((settingsRow as any)?.value) ? (settingsRow as any).value : [];
        const attendants = list.filter((p: any) => !!p?.active && String(p?.role || '').toLowerCase() === 'attendant');
        // Exact (normalized) match first
        const matchFull = attendants.find((p: any) => normalizeCode(p?.code || '') === full);
        // Loose match: ignore all non-alphanumeric, so "Jackson A" matches "jacksona"
        const matchLoose = matchFull ? null : attendants.find((p: any) => canonLoose(p?.code || '') === loose);
        let selected = matchFull || matchLoose || null;
        if (!selected && num) {
          const matches = attendants.filter((p: any) => canonNum(p?.code || '') === num);
          if (matches.length === 1) selected = matches[0];
          else if (matches.length > 1) return NextResponse.json({ ok: false, error: 'AMBIGUOUS_CODE' }, { status: 409 });
        }
        if (selected?.code) {
          const roleGuess = await detectRoleForCode(selected.code);
          row = await ensureLoginProvision(selected.code, roleGuess);
        }
      } catch (err) {
        console.error('admin_codes lookup failed', err);
        if (prismaIsSchemaError(err)) {
          return NextResponse.json({ ok: false, error: 'DB_SCHEMA_MISSING' }, { status: 503 });
        }
        return NextResponse.json({ ok: false, error: 'SESSION_STORE_UNAVAILABLE' }, { status: 503 });
      }
    }

    // Final safety: if still no row but scope mirror provides an outlet for this code, try provisioning once more
    if (!row) {
      try {
        const scopeRow = await (prisma as any).setting.findUnique({ where: { key: "attendant_scope" } });
        const map = (scopeRow as any)?.value || null;
        if (map && typeof map === "object") {
          const key = full;
          let entry = (map as any)[key] || (map as any)[canonFull(loginCode || "")] || null;
          if (!entry) {
            for (const k of Object.keys(map)) {
              if (normalizeCode(k) === key) { entry = (map as any)[k]; break; }
            }
          }
          const outlet = entry && typeof entry === "object" ? String((entry as any)?.outlet || "").trim() : "";
          if (outlet) {
            const roleGuess = await detectRoleForCode(loginCode || "");
            row = await ensureLoginProvision(loginCode || "", roleGuess);
          }
        }
      } catch {}
    }

    if (!row) return NextResponse.json({ ok: false, error: "INVALID_CODE" }, { status: 401 });

    const roleKey = await detectRoleForCode(row.code);

    // Lookup attendant → outlet by row.code
    let att: any = null;
    try {
      att = await (prisma as any).attendant.findFirst({
        where: { loginCode: { equals: row.code, mode: "insensitive" } },
        select: { id: true, outletId: true, loginCode: true, name: true },
      });
      if (!att?.outletId) {
        // Try to auto-heal binding now (e.g., existing LoginCode but no outlet)
        await ensureLoginProvision(row.code, roleKey);
        att = await (prisma as any).attendant.findFirst({
          where: { loginCode: { equals: row.code, mode: "insensitive" } },
          select: { id: true, outletId: true, loginCode: true, name: true },
        });
        if (!att?.outletId) {
          return NextResponse.json({ ok: false, error: "CODE_NOT_ASSIGNED" }, { status: 422 });
        }
      }
    } catch (err) {
      console.error("attendant lookup failed", err);
      if (prismaIsSchemaError(err)) {
        return NextResponse.json({ ok: false, error: "DB_SCHEMA_MISSING" }, { status: 503 });
      }
      return NextResponse.json({ ok: false, error: "SESSION_STORE_UNAVAILABLE" }, { status: 503 });
    }

    // Keep PersonCode role in sync with detected role
    try {
      await (prisma as any).personCode.update({
        where: { code: row.code },
        data: { role: roleKey, active: true },
      });
    } catch {
      try {
        await (prisma as any).personCode.create({
          data: { code: row.code, role: roleKey, name: att?.name || row.code, active: true },
        });
      } catch {}
    }

    // Resolve outlet code (not id) for session convenience
    let outletCode: string | undefined = undefined;
    try {
      if ((att as any)?.outletId) {
        const outlet = await (prisma as any).outlet.findUnique({
          where: { id: (att as any).outletId },
          select: { code: true, name: true },
        });
        outletCode = (outlet?.code || null) ?? undefined;
      }
    } catch {}

    // Create DB-backed session and set bk_sess cookie (attendant)
    try {
      const created = await createSession(att.id, outletCode);
      // Also explicitly attach Set-Cookie header to be robust across runtimes
      // (in addition to cookies().set inside createSession)
      // We'll add the header to the same response we return below.
      // Note: we can't set it yet because we haven't created the response.
      // We'll store it in a local var and append to response headers after creating it.
      var sessionHeader = serializeSessionCookie(created.token);
    } catch (err) {
      console.error("createSession failed", err);
      return NextResponse.json({ ok: false, error: "SESSION_CREATE_FAILED" }, { status: 503 });
    }

    // Also set a unified role cookie for convenience
    const res = NextResponse.json({ ok: true, role: roleKey, code: row.code, outlet: outletCode || null });
    if (typeof sessionHeader === "string") {
      res.headers.append("Set-Cookie", sessionHeader);
    }
    res.headers.append("Set-Cookie", serializeRoleCookie({ role: roleKey, code: row.code, outlet: outletCode || null }));
    return res;
  } catch (e) {
    console.error(e);
    const devMsg = (process.env.NODE_ENV !== 'production' && (e as any)?.message)
      ? `SERVER_ERROR: ${(e as any).message}`
      : 'SERVER_ERROR';
    return NextResponse.json({ ok: false, error: devMsg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  // Unified login for supervisor/supplier via admin_codes Setting
  try {
    const { code } = (await req.json().catch(() => ({}))) as { code?: string };
    const full = canonFull(code || "");
    const num = canonNum(code || "");
    if (!full && !num) return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });

    const row = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
    const list: any[] = Array.isArray((row as any)?.value) ? (row as any).value : [];

    const active = list.filter((p: any) => !!p?.active && ["supervisor", "supplier"].includes(String(p?.role || "").toLowerCase()));
    let found = active.find((p: any) => canonFull(p?.code || "") === full);
    if (!found && num) {
      const matches = active.filter((p: any) => canonNum(p?.code || "") === num);
      if (matches.length === 1) found = matches[0];
      else if (matches.length > 1) return NextResponse.json({ ok: false, error: "AMBIGUOUS_CODE" }, { status: 409 });
    }
    if (!found) return NextResponse.json({ ok: false, error: "INVALID_CODE" }, { status: 401 });

  const role = String(found.role).toLowerCase() as "supervisor" | "supplier";
    const outlet = (found as any)?.outlet || null;
    const res = NextResponse.json({ ok: true, role, code: found.code, outlet });
  res.headers.set("Set-Cookie", serializeRoleCookie({ role, code: found.code, outlet }));
    return res;
  } catch (e) {
    console.error("unified login error", e);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
