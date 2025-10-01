import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { normalizeCode, canonNum } from "@/lib/codeNormalize";

async function ensureLoginProvision(loginCode: string) {
  const code = normalizeCode(loginCode || "");
  if (!code) return null;

  const existing = await (prisma as any).loginCode.findUnique({ where: { code } }).catch(() => null);
  if (existing) return existing;

  const assignment = await (prisma as any).attendantAssignment.findUnique({ where: { code } }).catch(() => null);
  if (!assignment) return null;

  const person = await (prisma as any).personCode.findUnique({ where: { code } }).catch(() => null);
  let outletRow = null;
  if (assignment.outlet) {
    outletRow = await (prisma as any).outlet.findFirst({
      where: { name: { equals: assignment.outlet, mode: "insensitive" } },
    }).catch(() => null);
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
        name: person?.name || assignment.outlet || code,
        loginCode: code,
        outletId: outletRow?.id ?? null,
      },
    }).catch(() => null);
  }

  const attendantId = attendant?.id;
  if (!attendantId) return null;

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

    // 1) Try full canonical match in LoginCode
    let row: any = await (prisma as any).loginCode.findFirst({ where: { code: full } });

    if (!row && full) {
      row = await ensureLoginProvision(full);
    }

    // 2) Fallback to digits-only if unique
    if (!row && num) {
      const list: any[] = await (prisma as any).$queryRawUnsafe(
        `SELECT * FROM "LoginCode" WHERE regexp_replace(code, '\\D', '', 'g') = ${num} LIMIT 3`
      );
      if (list.length === 1) {
        row = list[0];
      } else if (list.length > 1) {
        return NextResponse.json({ ok: false, error: "AMBIGUOUS_CODE" }, { status: 409 });
      } else {
        const assignments: any[] = await (prisma as any).$queryRawUnsafe(
          `SELECT code FROM "AttendantAssignment" WHERE regexp_replace(code, '\\D', '', 'g') = ${num} LIMIT 3`
        );
        if (assignments.length === 1) {
          row = await ensureLoginProvision(assignments[0]?.code || '');
        } else if (assignments.length > 1) {
          return NextResponse.json({ ok: false, error: "AMBIGUOUS_CODE" }, { status: 409 });
        }
      }
    }

    if (!row) return NextResponse.json({ ok: false, error: "INVALID_CODE" }, { status: 401 });

    // Lookup attendant → outlet by row.code
    const att: any = await (prisma as any).attendant.findFirst({
      where: { loginCode: { equals: row.code, mode: "insensitive" } },
    });
    if (!att?.outletId) {
      return NextResponse.json({ ok: false, error: "CODE_NOT_ASSIGNED" }, { status: 422 });
    }

    const response = NextResponse.json({ ok: true, role: "attendant", code: row.code, outlet: att.outletId });
    response.cookies.set("attendant_auth", "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
