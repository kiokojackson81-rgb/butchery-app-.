import { NextResponse } from "next/server";
import { sendTemplate } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { to, template, params, langCode } = (await req.json()) as {
      to: string; template: string; params?: string[]; langCode?: string;
    };
    if (!to || !template) {
      return NextResponse.json({ ok: false, error: "to/template required" }, { status: 400 });
    }
    const r = await sendTemplate({ to, template, params, langCode });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "send failed" }, { status: 500 });
  }
}
