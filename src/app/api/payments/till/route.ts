import { NextResponse } from "next/server";
import { requireOutletSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(_req: Request) {
  const gate = await requireOutletSession();
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  return NextResponse.json({ ok: true, outlet: gate.outlet });
}

export async function GET() {
  // Keep shape stable for client: { ok: true, total, rows }
  return NextResponse.json({ ok: true, total: 0, rows: [] });
}

