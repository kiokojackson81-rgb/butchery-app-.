import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { resolveAssignment } from "@/lib/resolveAssignment";
import { normalizeCode } from "@/lib/normalizeCode";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get("code") || "").toString();
    const code = normalizeCode(raw);
    if (!code) return NextResponse.json({ ok: false, error: "code required" }, { status: 400 });
    const r = await resolveAssignment(code);
    if (!r) return NextResponse.json({ ok: false, code, resolved: null });
    return NextResponse.json({ ok: true, code, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server error" }, { status: 500 });
  }
}
