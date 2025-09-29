import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, serializeSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { code, outletCode } = (await req.json()) as { code: string; outletCode?: string };

    const login = await prisma.loginCode.findUnique({ where: { code }, include: { attendant: true } });
    if (!login || login.expiresAt < new Date()) {
      return NextResponse.json({ ok: false, error: "Invalid/expired code" }, { status: 401 });
    }

    let outletCodeFound: string | null = null;
    if (outletCode) {
      const outlet = await prisma.outlet.findFirst({ where: { code: outletCode }, select: { code: true } });
      if (!outlet?.code) return NextResponse.json({ ok: false, error: "Outlet not found" }, { status: 400 });
      outletCodeFound = outlet.code;
    }

  const { token } = await createSession(login.attendantId, outletCodeFound ?? undefined);

  await prisma.loginCode.delete({ where: { id: login.id } }).catch(() => {});

  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", serializeSessionCookie(token));
  return res;
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Login failed" }, { status: 500 });
  }
}
