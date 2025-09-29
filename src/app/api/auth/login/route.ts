import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { createSession, serializeSessionCookie } from "@/lib/session";
import { normalizeCode } from "@/lib/normalizeCode";
import { resolveAssignment } from "@/lib/resolveAssignment";

export async function POST(req: Request) {
  try {
    const { loginCode, outletCode } = (await req.json().catch(() => ({}))) as {
      loginCode?: string;
      outletCode?: string;
    };

    if (!loginCode || typeof loginCode !== "string") {
      return NextResponse.json({ ok: false, error: "loginCode required" }, { status: 400 });
    }

    // Normalize the code like attendant login
    const norm = normalizeCode(loginCode);

    // Prefer existing attendant row
    let att = await (prisma as any).attendant.findFirst({ where: { loginCode: norm } });

    // Fallback: resolve assignment from DB-first AttendantAssignment and create a minimal attendant row
    if (!att) {
      const resolved = await resolveAssignment(norm);
      if (resolved) {
        att = await (prisma as any).attendant.create({ data: { name: norm, loginCode: norm } }).catch(() => null as any);
        if (!att) {
          return NextResponse.json({ ok: false, error: "Failed to create attendant" }, { status: 500 });
        }
        await createSession(att.id, resolved.outlet);
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ ok: false, error: "Invalid code" }, { status: 401 });
    }

    let outletCodeFound: string | undefined;
    if (outletCode) {
      // Our schema does not enforce unique on code, so use findFirst safely
  const outlet = await (prisma as any).outlet.findFirst({ where: { code: outletCode } });
      if (!outlet) {
        return NextResponse.json({ ok: false, error: "Outlet not found" }, { status: 400 });
      }
      outletCodeFound = outlet.code ?? undefined;
    }

  await createSession(att.id, outletCodeFound);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Login failed" }, { status: 500 });
  }
}
