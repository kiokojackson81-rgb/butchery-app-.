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

  const att = await (prisma as any).attendant.findUnique({ where: { loginCode } });
    if (!att) {
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
