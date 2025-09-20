export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    cwd: process.cwd(),
    DATABASE_URL: process.env.DATABASE_URL || "(unset)",
    NODE_ENV: process.env.NODE_ENV,
  });
}
