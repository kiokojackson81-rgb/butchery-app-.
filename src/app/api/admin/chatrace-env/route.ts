import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEYS = [
  "CHATRACE_API_TOKEN",
  "CHATRACE_API_KEY",
  "CHATRACE_BASE_URL",
  "CHATRACE_BASE",
  "CHATRACE_API_BASE",
  "CHATRACE_SEND_TEXT_PATH",
  "CHATRACE_SEND_TEMPLATE_PATH",
  "CHATRACE_AUTH_HEADER",
  "CHATRACE_FROM_PHONE",
  "CHATRACE_SENDER_ID",
  "CHATRACE_WEBHOOK_SECRET",
] as const;

export async function GET() {
  const present: Record<string, boolean> = {};
  for (const k of KEYS) present[k] = !!process.env[k];
  return NextResponse.json({ present });
}
