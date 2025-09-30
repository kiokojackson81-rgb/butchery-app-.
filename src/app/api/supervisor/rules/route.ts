// app/api/supervisor/rules/route.ts
import { NextResponse } from "next/server";
import { getRules, setRules } from "@/server/supervisor/rules.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const rules = await getRules();
  return NextResponse.json({ ok: true, rules });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rules = await setRules(body);
    return NextResponse.json({ ok: true, rules });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 400 });
  }
}
