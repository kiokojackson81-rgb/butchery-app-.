import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/normalizeCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { code: raw, outlet, productKeys } = (await req.json()) as {
      code: string;
      outlet: string;
      productKeys: string[];
    };

    const norm = normalizeCode(raw);
    if (!norm || !outlet) return NextResponse.json({ ok: false, error: "code & outlet required" }, { status: 400 });
    // Use SQL UPSERT by unique code to avoid relying on id column presence
    await (prisma as any).$executeRawUnsafe(
      'INSERT INTO "AttendantAssignment" (code, outlet, "productKeys", "updatedAt") VALUES ($1, $2, $3::jsonb, NOW())\n       ON CONFLICT (code) DO UPDATE SET outlet = EXCLUDED.outlet, "productKeys" = EXCLUDED."productKeys", "updatedAt" = NOW()',
      norm,
      outlet,
      JSON.stringify(productKeys ?? [])
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('assignments upsert error', e);
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
