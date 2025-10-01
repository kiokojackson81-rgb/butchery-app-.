import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { createSession, serializeSessionCookie } from "@/lib/session";
import { normalizeCode } from "@/lib/codeNormalize";

export async function POST(req: Request) {
  try {
    const { loginCode, outletCode } = (await req.json().catch(() => ({}))) as {
      loginCode?: string;
      outletCode?: string;
    };

    if (!loginCode || typeof loginCode !== "string") {
      return NextResponse.json({ ok: false, error: "loginCode required" }, { status: 400 });
    }

    const norm = normalizeCode(loginCode);
    // Preferred: single Prisma lookup using equals + insensitive (UI-normalized already)
    const att = await (prisma as any).attendant.findFirst({
      where: { loginCode: { equals: norm, mode: "insensitive" } },
    });

    if (!att) {
      return NextResponse.json({ ok: false, error: "Invalid code" }, { status: 401 });
    }

    let outletCodeFound: string | undefined;
    if (outletCode) {
      // Our schema does not enforce unique on code, so use findFirst safely
      const fullOutlet = normalizeCode(outletCode);
      const outlet = await (prisma as any).outlet.findFirst({ where: { OR: [
        { code: outletCode },
        { code: fullOutlet }
      ] } });
      if (!outlet) {
        return NextResponse.json({ ok: false, error: "Outlet not found" }, { status: 400 });
      }
      outletCodeFound = outlet.code ?? undefined;
    }

    const { token } = await createSession(att.id, outletCodeFound);
    const res = NextResponse.json({ ok: true });
    res.headers.append("Set-Cookie", serializeSessionCookie(token));
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Login failed" }, { status: 500 });
  }
}
