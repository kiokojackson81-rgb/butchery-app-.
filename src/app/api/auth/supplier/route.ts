import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/normalizeCode";
import { rateLimit } from "@/lib/rateLimit";

export async function POST(req: Request) {
  try {
    const rl = rateLimit(req, "auth:supplier", 20, 60_000);
    if (!rl.allowed) return NextResponse.json({ ok: false, code: "ERR_RATE_LIMIT", message: "Too many attempts" }, { status: 429 });

    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ ok: false, code: "ERR_BAD_REQUEST", message: "Code required" }, { status: 400 });
    }
    const norm = normalizeCode(code);
    const person = await (prisma as any).personCode.findUnique({ where: { code: norm } });
    if (!person || person.role !== "supplier" || person.active !== true) {
      return NextResponse.json({ ok: false, code: "ERR_NOT_FOUND", message: "Code not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, name: person.name || "Supplier", code: person.code });
  } catch (e) {
    console.error("/api/auth/supplier POST error", e);
    return NextResponse.json({ ok: false, code: "ERR_SERVER", message: "Server error" }, { status: 500 });
  }
}
