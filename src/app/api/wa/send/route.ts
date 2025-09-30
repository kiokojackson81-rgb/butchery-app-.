import { NextResponse } from "next/server";
import { sendTemplate } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { to, template, params, langCode, dryRun } = (await req.json().catch(() => ({}))) as any;
    if (!to || !template)
      return NextResponse.json({ ok: false, error: "to/template required" }, { status: 400 });
    const prev = process.env.WA_DRY_RUN;
    if (dryRun === true) process.env.WA_DRY_RUN = "true";
    const res = await sendTemplate({ to, template, params, langCode });
    if (dryRun === true) process.env.WA_DRY_RUN = prev;
  return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "send failed" }, { status: 500 });
  }
}
