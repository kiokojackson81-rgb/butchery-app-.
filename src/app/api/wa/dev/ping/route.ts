import { NextResponse } from "next/server";
import { sendText } from "@/lib/wa";
import { toGraphPhone } from "@/server/canon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/wa/dev/ping?phone=+2547...&key=ADMIN_DIAG_KEY[&msg=hello]
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const phoneRaw = searchParams.get("phone") || searchParams.get("to") || "";
    const key = searchParams.get("key") || "";
    const msg = searchParams.get("msg") || "ping";
    const adminKey = process.env.ADMIN_DIAG_KEY || "";
    if (!adminKey || key !== adminKey) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    const digits = String(phoneRaw).replace(/[^0-9+]/g, "");
    const e164 = digits.startsWith("+") ? digits : "+" + digits;
    if (!e164 || e164.length < 10) return NextResponse.json({ ok: false, error: "phone required" }, { status: 400 });
    const to = toGraphPhone(e164); // Graph expects 2547...
  const res = await sendText(to, msg, "AI_DISPATCH_TEXT", { gpt_sent: true });
    return NextResponse.json({ ok: (res as any)?.ok === true, res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ping failed" }, { status: 500 });
  }
}
