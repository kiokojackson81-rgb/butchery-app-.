import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
// GPT removed; keep route as stub to avoid 404s in old clients

export async function POST(req: Request) {
  try {
    const { phoneE164, text } = await req.json();
    if (!phoneE164 || typeof text !== "string") return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
  return NextResponse.json({ ok: false, error: "GPT_DISABLED" }, { status: 410 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
