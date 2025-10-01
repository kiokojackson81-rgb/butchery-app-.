import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { createSession, serializeSessionCookie } from "@/lib/session";
import { canonFull, canonNum } from "@/lib/codeNormalize";

export async function POST(req: Request) {
  try {
    const { loginCode, outletCode } = (await req.json().catch(() => ({}))) as {
      loginCode?: string;
      outletCode?: string;
    };

    if (!loginCode || typeof loginCode !== "string") {
      return NextResponse.json({ ok: false, error: "loginCode required" }, { status: 400 });
    }

    const full = canonFull(loginCode);
    const num = canonNum(loginCode);

    // Tolerant lookup by Attendant.loginCode
    let att = await (prisma as any).attendant.findFirst({ where: { loginCode: { equals: loginCode, mode: "insensitive" } } });
    if (!att) {
      // Try full canonical via raw SQL (strip spaces + lower)
      const byFull: any = await (prisma as any).$queryRawUnsafe(
        `SELECT * FROM "Attendant" WHERE lower(regexp_replace("loginCode", '\\s+', '', 'g')) = ${full} LIMIT 1`
      ).then((r: any[]) => r?.[0]);
      att = byFull || att;

      if (!att && num) {
        const list: any[] = await (prisma as any).$queryRawUnsafe(
          `SELECT * FROM "Attendant" WHERE regexp_replace("loginCode", '\\D', '', 'g') = ${num} LIMIT 3`
        );
        if (list.length === 1) att = list[0];
        else if (list.length > 1) return NextResponse.json({ ok: false, error: "Ambiguous code (multiple matches by number)" }, { status: 409 });
      }
    }

    if (!att) {
      return NextResponse.json({ ok: false, error: "Invalid code" }, { status: 401 });
    }

    let outletCodeFound: string | undefined;
    if (outletCode) {
      // Our schema does not enforce unique on code, so use findFirst safely
      const fullOutlet = canonFull(outletCode);
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
