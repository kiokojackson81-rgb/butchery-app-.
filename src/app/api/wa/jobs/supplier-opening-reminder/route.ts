import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
import { runSupplierOpeningReminder } from "@/server/wa/reminders";

export async function GET() {
  try { const r = await runSupplierOpeningReminder(); return NextResponse.json(r as any); }
  catch (e:any) { return NextResponse.json({ ok: false, error: String(e?.message ?? e) }); }
}
