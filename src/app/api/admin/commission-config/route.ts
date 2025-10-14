import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Note: In this project, admin auth is client-only (sessionStorage "admin_auth").
// For server API simplicity, we accept a shared header flag in dev; in prod you should
// tighten this to your existing admin verification approach.
function isAdmin(req: Request): boolean {
  const h = req.headers.get("x-admin-auth") || req.headers.get("x-admin-token");
  return !!h && h === (process.env.ADMIN_API_TOKEN || h);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    let attendantId = searchParams.get("attendantId");
    const code = searchParams.get("code");
    if (!attendantId && code) {
      try {
        const att = await (prisma as any).attendant.findFirst({ where: { loginCode: { equals: code, mode: "insensitive" } } });
        attendantId = att?.id || attendantId;
      } catch {}
    }
    if (!attendantId) return NextResponse.json({ ok: false, error: "attendantId or code required" }, { status: 400 });
    const cfg = await (prisma as any).commissionConfig.findUnique({ where: { attendantId } }).catch(() => null);
    return NextResponse.json({ ok: true, config: cfg || null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!isAdmin(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    let attendantId = String(body?.attendantId || "").trim();
    const code = typeof body?.code === 'string' ? String(body?.code).trim() : "";
    if (!attendantId && code) {
      try {
        const att = await (prisma as any).attendant.findFirst({ where: { loginCode: { equals: code, mode: "insensitive" } } });
        attendantId = att?.id || attendantId;
      } catch {}
    }
    const targetKg = Number(body?.targetKg ?? 25);
    const ratePerKg = Number(body?.ratePerKg ?? 50);
    const isActive = body?.isActive !== false;
    if (!attendantId) return NextResponse.json({ ok: false, error: "attendantId or code required" }, { status: 400 });
    const res = await (prisma as any).commissionConfig.upsert({
      where: { attendantId },
      update: { targetKg, ratePerKg, isActive },
      create: { attendantId, targetKg, ratePerKg, isActive },
    });
    return NextResponse.json({ ok: true, config: res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
