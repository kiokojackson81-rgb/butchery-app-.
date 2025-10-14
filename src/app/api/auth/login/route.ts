import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { normalizeCode, canonNum, canonFull } from "@/lib/codeNormalize";
import { createSession } from "@/lib/session";
import { serializeRoleCookie } from "@/lib/roleSession";

async function ensureLoginProvision(loginCode: string) {
  const code = normalizeCode(loginCode || "");
  if (!code) return null;

  const existing = await (prisma as any).loginCode.findUnique({ where: { code } }).catch(() => null);

  // Try both normalized scope and legacy assignment
  const [assignment, scope] = await Promise.all([
    (prisma as any).attendantAssignment.findUnique({ where: { code } }).catch(() => null),
    (prisma as any).attendantScope.findFirst({ where: { codeNorm: code } }).catch(() => null),
  ]);

  // Fallback: consult admin_codes Setting (active attendant records)
  let fallbackOutlet: string | null = null;
  if (!assignment && !scope) {
    try {
      const settingsRow = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
      const list: any[] = Array.isArray((settingsRow as any)?.value) ? (settingsRow as any).value : [];
      const attendants = list.filter(
        (p: any) => !!p?.active && String(p?.role || "").toLowerCase() === "attendant"
      );
      const selected = attendants.find((p: any) => normalizeCode(p?.code || "") === code);
      if (selected?.outlet) fallbackOutlet = String(selected.outlet);
    } catch {}
  }
  if (!assignment && !scope && !fallbackOutlet && !existing) return null;

  const person = await (prisma as any).personCode.findUnique({ where: { code } }).catch(() => null);
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

  let attendant = await (prisma as any).attendant.findFirst({
    where: { loginCode: { equals: code, mode: "insensitive" } },
  }).catch(() => null);

  if (attendant) {
    if (!attendant.outletId && outletRow?.id) {
      attendant = await (prisma as any).attendant.update({
        where: { id: attendant.id },
        data: { outletId: outletRow.id },
      }).catch(() => attendant);
    }
  } else {
    attendant = await (prisma as any).attendant.create({
      data: {
        name: person?.name || outletName || code,
        loginCode: code,
        outletId: outletRow?.id ?? null,
      },
    }).catch(() => null);
  }

  const attendantId = attendant?.id;
  if (!attendantId) return existing;

  if (!person) {
    await (prisma as any).personCode.create({
      data: { code, role: "attendant", name: attendant.name, active: true },
    }).catch(() => null);
  } else if (person.role !== "attendant" || person.active === false) {
    await (prisma as any).personCode.update({
      where: { id: person.id },
      data: { role: "attendant", active: true },
    }).catch(() => null);
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const login = await (prisma as any).loginCode.upsert({
    where: { code },
    update: { attendantId, expiresAt },
    create: { code, attendantId, expiresAt },
  }).catch(() => null);

  return login;
}

export async function POST(req: Request) {
  try {
    const { loginCode } = (await req.json().catch(() => ({}))) as { loginCode?: string };
  const full = normalizeCode(loginCode || "");
  const num = canonNum(loginCode || "");

    if (!full && !num) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
    }

  // 1) Try full canonical match in LoginCode (normalized)
  let row: any = null;
  try {
    row = await (prisma as any).loginCode.findFirst({ where: { code: full } });
  } catch (err) {
    console.error("loginCode lookup failed", err);
  }

    if (!row && full) {
      row = await ensureLoginProvision(full);
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
            row = await ensureLoginProvision(assignments[0]?.code || '');
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
        const matchFull = attendants.find((p: any) => normalizeCode(p?.code || '') === full);
        let selected = matchFull;
        if (!selected && num) {
          const matches = attendants.filter((p: any) => canonNum(p?.code || '') === num);
          if (matches.length === 1) selected = matches[0];
          else if (matches.length > 1) return NextResponse.json({ ok: false, error: 'AMBIGUOUS_CODE' }, { status: 409 });
        }
        if (selected?.code) {
          row = await ensureLoginProvision(selected.code);
        }
      } catch (err) {
        console.error('admin_codes lookup failed', err);
        return NextResponse.json({ ok: false, error: 'SESSION_STORE_UNAVAILABLE' }, { status: 503 });
      }
    }

    if (!row) return NextResponse.json({ ok: false, error: "INVALID_CODE" }, { status: 401 });

    // Lookup attendant → outlet by row.code
    let att: any = null;
    try {
      att = await (prisma as any).attendant.findFirst({
        where: { loginCode: { equals: row.code, mode: "insensitive" } },
      });
      if (!att?.outletId) {
        // Try to auto-heal binding now (e.g., existing LoginCode but no outlet)
        await ensureLoginProvision(row.code);
        att = await (prisma as any).attendant.findFirst({
          where: { loginCode: { equals: row.code, mode: "insensitive" } },
        });
        if (!att?.outletId) {
          return NextResponse.json({ ok: false, error: "CODE_NOT_ASSIGNED" }, { status: 422 });
        }
      }
    } catch (err) {
      console.error("attendant lookup failed", err);
      return NextResponse.json({ ok: false, error: "SESSION_STORE_UNAVAILABLE" }, { status: 503 });
    }

    // Create DB-backed session and set bk_sess cookie (attendant)
    try {
      await createSession(att.id);
    } catch (err) {
      console.error("createSession failed", err);
      return NextResponse.json({ ok: false, error: "SESSION_CREATE_FAILED" }, { status: 503 });
    }

    // Also set a unified role cookie for convenience
    const res = NextResponse.json({ ok: true, role: "attendant", code: row.code, outlet: att.outletId });
    res.headers.append("Set-Cookie", serializeRoleCookie({ role: "attendant", code: row.code, outlet: (att as any)?.outletId || null }));
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
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
