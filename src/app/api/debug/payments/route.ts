export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  // No mpesaPayment table in current schema; return stub for compatibility
  return NextResponse.json({ ok: true, rows: [] });
}
