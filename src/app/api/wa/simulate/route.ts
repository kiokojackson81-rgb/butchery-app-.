import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleAuthenticatedText, handleAuthenticatedInteractive } from "@/server/wa_attendant_flow";
import { handleSupervisorText, handleSupervisorAction } from "@/server/wa/wa_supervisor_flow";
import { handleSupplierText, handleSupplierAction } from "@/server/wa/wa_supplier_flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Dev-only simulator: trigger text or interactive replies without hitting Meta Graph.
// POST { phoneE164: "+2547...", text?: string, buttonId?: string }
export async function POST(req: Request) {
  try {
    const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
    if (!DRY) return NextResponse.json({ ok: false, error: "DISABLED" }, { status: 403 });
    const { phoneE164, text, buttonId } = (await req.json()) as { phoneE164: string; text?: string; buttonId?: string };
    if (!phoneE164) return NextResponse.json({ ok: false, error: "phoneE164 required" }, { status: 400 });

    const sess = await (prisma as any).waSession.findUnique({ where: { phoneE164 } });
    if (!sess) return NextResponse.json({ ok: false, error: "no session" }, { status: 404 });

    const role = String(sess.role || "attendant");
    if (text) {
      if (role === "supervisor") await handleSupervisorText(sess, text, phoneE164);
      else if (role === "supplier") await handleSupplierText(sess, text, phoneE164);
      else await handleAuthenticatedText(sess, text);
      return NextResponse.json({ ok: true });
    }
    if (buttonId) {
      if (role === "supervisor") await handleSupervisorAction(sess, buttonId, phoneE164);
      else if (role === "supplier") await handleSupplierAction(sess, buttonId, phoneE164);
      else await handleAuthenticatedInteractive(sess, buttonId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "text or buttonId required" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "simulate failed" }, { status: 500 });
  }
}
