import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { createSession, serializeSessionCookie } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const { loginCode, outletCode } = (await req.json().catch(() => ({}))) as {
      loginCode?: string;
      outletCode?: string;
    };

    if (!loginCode || typeof loginCode !== "string") {
      return NextResponse.json({ ok: false, error: "loginCode required" }, { status: 400 });
    }

    const att = await prisma.attendant.findUnique({ where: { loginCode } });
    if (!att) {
      return NextResponse.json({ ok: false, error: "Invalid code" }, { status: 401 });
    }

    let outletCodeFound: string | undefined;
    if (outletCode) {
      // Our schema does not enforce unique on code, so use findFirst safely
      const outlet = await prisma.outlet.findFirst({ where: { code: outletCode } });
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
