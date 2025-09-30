import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { updateStatusByWamid, logOutbound } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "barakaops-verify";
  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false }, { status: 403 });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const v = change.value || {};
        const msgs = Array.isArray(v.messages) ? v.messages : [];
        const statuses = Array.isArray(v.statuses) ? v.statuses : [];

        for (const m of msgs) {
          const id = (m.id as string | undefined) || null;
          await (prisma as any).waMessageLog.create({
            data: { direction: "in", templateName: null, payload: m as any, waMessageId: id, status: (m.type as string) || "MESSAGE" },
          });
          // TODO: route by user role based on phone `+${m.from}`
        }

        for (const s of statuses) {
          const id = (s.id as string | undefined) || null;
          const status = (s.status as string | undefined) || null;
          if (id && status) await updateStatusByWamid(id, status.toUpperCase());
        }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    await logOutbound({ direction: "in", payload: { error: e?.message || String(e) }, status: "ERROR" });
    // Do not fail hard; FB expects 200s generally
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
