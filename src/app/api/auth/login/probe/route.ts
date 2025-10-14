import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { normalizeCode, canonNum } from "@/lib/codeNormalize";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const codeIn = url.searchParams.get("code") || "";
  const full = normalizeCode(codeIn);
  const num = canonNum(codeIn);
  const out: any = { ok: true, input: { codeIn, full, num } };

  if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) {
    return NextResponse.json({ ok: false, error: "DB_NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    // 1) Can read LoginCode by full?
    try {
      const r = await (prisma as any).loginCode.findFirst({ where: { code: full } });
      out.loginCode_full = r ? { found: true, id: r.id, attendantId: r.attendantId } : { found: false };
    } catch (e: any) {
      out.loginCode_full = { error: String(e?.message || e) };
    }

    // 2) Can read LoginCode by digits-only?
    try {
      if (num) {
        const list: any[] = await (prisma as any).$queryRaw`
          SELECT id, code, attendantId FROM "LoginCode"
          WHERE regexp_replace(code, '\\D', '', 'g') = ${num}
          LIMIT 3
        `;
        out.loginCode_num = { count: list.length, codes: list.map((x: any) => x.code) };
      } else {
        out.loginCode_num = { skipped: true };
      }
    } catch (e: any) {
      out.loginCode_num = { error: String(e?.message || e) };
    }

    // 3) admin_codes setting reachable?
    try {
      const settingsRow = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
      out.admin_codes = { present: !!settingsRow, type: typeof (settingsRow as any)?.value };
    } catch (e: any) {
      out.admin_codes = { error: String(e?.message || e) };
    }

    // 4) Attendant find by loginCode (case-insensitive) and outlet binding
    try {
      const att = await (prisma as any).attendant.findFirst({
        where: { loginCode: { equals: full, mode: "insensitive" } },
        select: { id: true, outletId: true, loginCode: true, name: true },
      });
      out.attendant = att ? { found: true, id: att.id, outletId: (att as any).outletId || null } : { found: false };
    } catch (e: any) {
      out.attendant = { error: String(e?.message || e) };
    }

    // 5) Minimal write test? No — probe stays read-only.
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
