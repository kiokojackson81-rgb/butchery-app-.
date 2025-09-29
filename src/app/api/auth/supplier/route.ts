import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";
import { normalizeCode } from "@/lib/normalizeCode";

export async function POST(req: Request) {
  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ ok: false, error: "Code required" }, { status: 400 });
    }
  const norm = normalizeCode(code);

    const row = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
    const list = Array.isArray((row as any)?.value) ? (row as any).value : [];

    const found = list.find((p: any) => {
      const role = (p?.role || "").toString().toLowerCase();
      const active = !!p?.active;
  const c = normalizeCode((p?.code || "").toString());
  return active && role === "supplier" && c === norm;
    });

    if (!found) return NextResponse.json({ ok: false, error: "Code not found" }, { status: 404 });
    return NextResponse.json({ ok: true, name: found?.name || "Supplier", code: found?.code });
  } catch (e) {
    console.error("supplier login error", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
