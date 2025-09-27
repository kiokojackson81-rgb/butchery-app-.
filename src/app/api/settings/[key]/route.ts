import { NextResponse } from "next/server";
// Ensure Node.js runtime (Prisma is not Edge-compatible)
export const runtime = "nodejs";
// Avoid caching in production and force dynamic execution
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";

export async function GET(
  _req: Request,
  context: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await context.params;
    // Cast prisma to any here to avoid TS complaints if the local client types are stale.
    const row = await (prisma as any).setting.findUnique({
      where: { key },
    });
    return NextResponse.json({ ok: true, value: (row as any)?.value ?? null });
  } catch (e: any) {
    // Never throw; always return a safe shape
    return NextResponse.json({ ok: true, value: null, error: String(e?.message ?? e) });
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { value?: any };
    const saved = await (prisma as any).setting.upsert({
      where: { key },
      create: { key, value: body?.value ?? null },
      update: { value: body?.value ?? null },
    });
    return NextResponse.json({ ok: true, value: (saved as any).value });
  } catch (e: any) {
    // Keep status 200 to avoid fetch error handling on the client; include error string
    return NextResponse.json({ ok: false, value: null, error: String(e?.message ?? e) });
  }
}
