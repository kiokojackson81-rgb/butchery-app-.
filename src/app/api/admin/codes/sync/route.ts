import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/normalizeCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/admin/codes/sync
 * Body: { codes: [{ name, code, role, active }] }
 * Mirrors thin-KV people codes into relational PersonCode table.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const arr = Array.isArray(body?.codes) ? body.codes : [];
    if (arr.length === 0) return NextResponse.json({ ok: true, count: 0 });

    let count = 0;
    for (const row of arr) {
      const name = (row?.name || "").toString().trim();
      const codeRaw = (row?.code || "").toString();
      const roleRaw = (row?.role || "attendant").toString().toLowerCase();
      const active = Boolean(row?.active ?? true);
      const code = normalizeCode(codeRaw);
      if (!code) continue;

      // Map to Prisma enum PersonRole
      const role = roleRaw === "supervisor" ? "supervisor" : roleRaw === "supplier" ? "supplier" : "attendant";

      // Upsert by unique code
      const existing = await (prisma as any).personCode.findUnique({ where: { code } }).catch(() => null);
      if (existing) {
        await (prisma as any).personCode.update({ where: { code }, data: { name, role, active } });
      } else {
        await (prisma as any).personCode.create({ data: { code, name, role, active } });
      }
      count++;
    }

    return NextResponse.json({ ok: true, count });
  } catch (e) {
    console.error("/api/admin/codes/sync POST error", e);
    return NextResponse.json({ ok: false, code: "ERR_SERVER", message: "Server error" }, { status: 500 });
  }
}
