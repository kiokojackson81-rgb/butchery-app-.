import { NextResponse } from "next/server";
import { sendTemplate } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { to, template, params, langCode } = (await req.json().catch(() => ({}))) as any;
    if (!to || !template)
      return NextResponse.json({ ok: false, error: "to/template required" }, { status: 400 });
  const res = await sendTemplate({ to, template, params, langCode });
  return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "send failed" }, { status: 500 });
  }
}
