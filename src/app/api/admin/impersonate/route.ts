import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull, canonLoose, normalizeCode } from "@/lib/codeNormalize";
import { createSession, serializeSessionCookie } from "@/lib/session";
import { serializeRoleCookie } from "@/lib/roleSession";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

type Role = "attendant" | "supervisor" | "supplier";

async function resolveOutletRow(outletName?: string | null) {
  const name = (outletName || "").trim();
  if (!name) return null as any;
  let row = await (prisma as any).outlet.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true, code: true } }).catch(() => null);
  if (!row) {
    try {
      row = await (prisma as any).outlet.create({ data: { name, code: canonFull(name), active: true }, select: { id: true, name: true, code: true } });
    } catch {
      // last attempt re-read
      row = await (prisma as any).outlet.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true, code: true } }).catch(() => null);
    }
  }
  return row;
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    // Previously required STATUS_PUBLIC_KEY via query/header; removed to streamline admin Login-as.

  const { role, code, outlet } = (await req.json().catch(() => ({}))) as { role?: Role; code?: string; outlet?: string };
    const roleKey = String(role || "").toLowerCase() as Role;
    const full = canonFull(code || "");
    const loose = canonLoose(code || "");
    if (!roleKey || !["attendant","supervisor","supplier"].includes(roleKey) || (!full && !loose)) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
    }

    if (roleKey === "attendant") {
      const loginCode = normalizeCode(code || "");
      if (!loginCode) return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });

      // Try to locate attendant, or create minimal record
      let att: any = await (prisma as any).attendant.findFirst({
        where: { loginCode: { equals: loginCode, mode: "insensitive" } },
        select: { id: true, outletId: true, loginCode: true, name: true },
      }).catch(() => null);

      // If outlet provided, ensure outlet exists and bind attendant to it
      let outletRow: any = null;
      if (outlet) {
        outletRow = await resolveOutletRow(outlet);
      } else if (!att?.outletId) {
        // Attempt to derive from AttendantScope -> outletName
        try {
          const sc = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: loginCode } });
          if (sc?.outletName) outletRow = await resolveOutletRow(sc.outletName);
        } catch {}
      }

      if (!att) {
        // Create with optional outlet binding
        try {
          att = await (prisma as any).attendant.create({
            data: { name: outlet || loginCode, loginCode, outletId: outletRow?.id ?? null },
            select: { id: true, outletId: true, loginCode: true, name: true },
          });
        } catch {
          // Last-resort fetch
          att = await (prisma as any).attendant.findFirst({ where: { loginCode: { equals: loginCode, mode: "insensitive" } }, select: { id: true, outletId: true, loginCode: true, name: true } }).catch(() => null);
        }
      } else if (!att?.outletId && outletRow?.id) {
        try { await (prisma as any).attendant.update({ where: { id: att.id }, data: { outletId: outletRow.id } }); att.outletId = outletRow.id; } catch {}
      }

      if (!att?.id) return NextResponse.json({ ok: false, error: "ATTENDANT_NOT_FOUND" }, { status: 404 });

      // Resolve outletCode for session convenience
      let outletCode: string | undefined = undefined;
      try {
        const row = att.outletId ? await (prisma as any).outlet.findUnique({ where: { id: att.outletId }, select: { code: true, name: true } }) : null;
        outletCode = (row?.code || null) ?? undefined;
      } catch {}
      if (!outletCode && outletRow?.code) outletCode = outletRow.code;

      // Mint DB session cookie and role cookie
      let sessionHeader: string | null = null;
      try {
        const created = await createSession(att.id, outletCode);
        sessionHeader = serializeSessionCookie(created.token);
      } catch {
        return NextResponse.json({ ok: false, error: "SESSION_CREATE_FAILED" }, { status: 503 });
      }

      const res = NextResponse.json({ ok: true, role: "attendant", code: loginCode, outlet: outletCode || null, redirect: "/attendant/dashboard" });
      if (sessionHeader) res.headers.append("Set-Cookie", sessionHeader);
      res.headers.append("Set-Cookie", serializeRoleCookie({ role: "attendant", code: loginCode, outlet: outletCode || null }));
      return res;
    }

    // supervisor / supplier — use lightweight role cookie only
    const roleOutlet = (outlet || null) as string | null;
    const res = NextResponse.json({ ok: true, role: roleKey, code: full || loose, outlet: roleOutlet, redirect: roleKey === "supplier" ? "/admin?tab=ops&opsTab=supply" : "/admin?tab=ops" });
    res.headers.set("Set-Cookie", serializeRoleCookie({ role: roleKey, code: full || loose, outlet: roleOutlet }));
    return res;
  } catch (e) {
    console.error("impersonate error", e);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
