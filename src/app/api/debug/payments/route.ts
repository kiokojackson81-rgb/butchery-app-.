export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  // No mpesaPayment table in current schema; return stub for compatibility
  return NextResponse.json({ ok: true, rows: [] });
}
