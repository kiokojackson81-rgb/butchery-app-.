import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
import { runGptForIncoming } from "@/lib/gpt_router";

export async function POST(req: Request) {
  try {
    const { phoneE164, text } = await req.json();
    if (!phoneE164 || typeof text !== "string") return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
    const reply = await runGptForIncoming(phoneE164, text);
    return NextResponse.json({ ok: true, reply });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
