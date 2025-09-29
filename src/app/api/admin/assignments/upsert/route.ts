import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { code, outlet, productKeys } = (await req.json()) as {
      code: string;
      outlet: string;
      productKeys: string[];
    };

    if (!code || !outlet) return NextResponse.json({ ok: false, error: "code & outlet required" }, { status: 400 });

    const norm = code.trim().replace(/\s+/g, "").toLowerCase();
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
