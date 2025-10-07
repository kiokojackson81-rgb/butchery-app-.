import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Decommissioned: Chatrace webhook is disabled. Return 410 Gone to ensure no reply path other than Graph→Webhook→GPT.
export async function POST() {
  return NextResponse.json({ ok: false, error: "Chatrace webhook disabled" }, { status: 410 });
}
