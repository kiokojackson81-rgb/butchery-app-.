import { NextResponse } from "next/server";
import { sendText } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { to, text } = (await req.json()) as { to: string; text: string };
    if (!to || !text) return NextResponse.json({ ok: false, error: "to/text required" }, { status: 400 });
    const r = await sendText(to, text);
    if ((r as any)?.ok) return NextResponse.json({ ok: true, id: (r as any)?.waMessageId || null });
    return NextResponse.json({ ok: false, error: (r as any)?.error || "send failed" }, { status: 500 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "send failed" }, { status: 500 });
  }
}
