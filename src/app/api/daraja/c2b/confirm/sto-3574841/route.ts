import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Reuse the base confirm handler by importing its POST and forwarding the request body.
import { POST as BaseConfirmPOST } from "../route";

export async function POST(req: Request) {
  const receivedAt = new Date().toISOString();
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
  const raw = await req.text().catch(() => "");
  console.log("[C2B/confirm:sto-3574841] hit", { receivedAt, ip, len: raw.length });

  // Forward the payload to the base confirm POST to keep all persistence logic centralized
  const fwd = new Request("http://local/confirm", { method: "POST", headers: req.headers, body: raw });
  return BaseConfirmPOST(fwd);
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST only (sto-3574841)" });
}
