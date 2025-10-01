import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { normalizeCode, canonNum } from "@/lib/codeNormalize";

export async function POST(req: Request) {
  try {
    const { loginCode } = (await req.json().catch(() => ({}))) as { loginCode?: string };
  const full = normalizeCode(loginCode || "");
  const num = canonNum(loginCode || "");

    if (!full && !num) {
      return Response.json({ ok: false, error: "Empty code" }, { status: 400 });
    }

    // 1) Try full canonical match in LoginCode
    let row: any = await (prisma as any).loginCode.findFirst({ where: { code: full } });

    // 2) Fallback to digits-only if unique
    if (!row && num) {
      const list: any[] = await (prisma as any).$queryRawUnsafe(
        `SELECT * FROM "LoginCode" WHERE regexp_replace(code, '\\D', '', 'g') = ${num} LIMIT 3`
      );
      if (list.length === 1) row = list[0];
      else if (list.length > 1) {
        return Response.json({ ok: false, error: "Ambiguous code (multiple matches)" }, { status: 409 });
      }
    }

    if (!row) return Response.json({ ok: false, error: "Invalid code" }, { status: 401 });

    // Lookup attendant → outlet by row.code
    const att: any = await (prisma as any).attendant.findFirst({
      where: { loginCode: { equals: row.code, mode: "insensitive" } },
    });
    if (!att?.outletId) {
      return Response.json({ ok: false, error: "Code not assigned to outlet" }, { status: 422 });
    }

    return Response.json({ ok: true, role: "attendant", code: row.code, outlet: att.outletId });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
