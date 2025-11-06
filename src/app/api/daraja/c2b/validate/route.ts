import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Minimal C2B ValidationURL handler — always accept and log for diagnostics.
// Safaricom will POST a payload before ConfirmationURL when ValidationURL is set.
// We do not persist anything here; persistence happens in the ConfirmationURL route.
export async function POST(req: Request) {
  const receivedAt = new Date().toISOString();
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
  const raw = await req.text().catch(() => "");
  let json: any = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch {}
  console.log("[C2B/validate] hit", { receivedAt, ip, len: raw.length });

  // Always accept so ConfirmationURL will be invoked.
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}

