import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Deprecated endpoint: supplier login via code is no longer supported.
// Keeping a stub to avoid breaking clients; returns 410 Gone consistently.
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Deprecated: supplier login via code is no longer supported" },
    { status: 410 }
  );
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Deprecated: supplier login via code is no longer supported" },
    { status: 410 }
  );
}
