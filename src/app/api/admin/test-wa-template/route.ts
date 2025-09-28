import { NextResponse } from "next/server";
import { WaTemplates, bodyParams } from "@/lib/wa-templates";
import { sendWaTemplate } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse("Not found", { status: 404 });
  }
  const { to, template, params = [] } = await req.json().catch(() => ({}));
  const key = String(template || "") as keyof typeof WaTemplates;
  if (!to || !template || !WaTemplates[key]) {
    return NextResponse.json({ ok: false, error: "to, template (one of registry), params[]" }, { status: 400 });
  }
  const t = WaTemplates[key];
  const res = await sendWaTemplate(String(to), t.name, t.lang, bodyParams((params as string[]).map(String)));
  return NextResponse.json(res);
}
