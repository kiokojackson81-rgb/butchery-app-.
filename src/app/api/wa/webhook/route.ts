import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { logOutbound, updateStatusByWamid } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function verifySignature(body: string, sig: string | null) {
  try {
    const appSecret = process.env.WHATSAPP_APP_SECRET!;
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(body).digest("hex");
    return !!sig && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// GET: verification
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const vt = process.env.WHATSAPP_VERIFY_TOKEN || "barakaops-verify";

  if (mode === "subscribe" && token === vt && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false }, { status: 403 });
}

// POST: receive events
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256");

  if (!verifySignature(raw, sig)) {
    // Return 200 (Meta expects) but log error
    await logOutbound({ direction: "in", payload: { error: "bad signature" }, status: "ERROR" });
    return NextResponse.json({ ok: true });
  }

  const body = JSON.parse(raw || "{}");

  try {
    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const v = change.value || {};
  const msgs = Array.isArray(v.messages) ? v.messages : [];
        const statuses = Array.isArray(v.statuses) ? v.statuses : [];

        // inbound
        for (const m of msgs) {
          const from = m.from as string | undefined; // 2547...
          const id = m.id as string | undefined;
          await (prisma as any).waMessageLog.create({
            data: {
              direction: "in",
              templateName: null,
              payload: m as any,
              waMessageId: id || null,
              status: (m.type as string) || "MESSAGE",
            },
          });
          // Optional: link attendant by phone if available (placeholder; schema may need phone on Attendant)
          try {
            const phone = from ? `+${from}` : null;
            if (phone && id) {
              await (prisma as any).waMessageLog.updateMany({ where: { waMessageId: id }, data: { /* attendantId: ... */ } });
            }
          } catch {}

          // Simple flow handling: interactive replies and text commands
          try {
            const { handleAttendantInteractive, handleAttendantText } = await import("@/lib/wa_attendant_flow");
            const { sendText } = await import("@/lib/wa");
            const phone = from ? `+${from}` : undefined;
            if (phone) {
              if (m.type === "interactive") {
                const lr = m.interactive?.list_reply?.id as string | undefined;
                const br = m.interactive?.button_reply?.id as string | undefined;
                const actionId = lr || br;
                if (actionId) {
                  const reply = await handleAttendantInteractive(phone, actionId);
                  if (reply) await sendText(phone, String(reply).slice(0, 4096));
                }
              } else if (m.type === "text" && m.text?.body) {
                const reply = await handleAttendantText(phone, String(m.text.body));
                if (reply) await sendText(phone, String(reply).slice(0, 4096));
              }
            }
          } catch (err) {
            await logOutbound({ direction: "in", payload: { error: `flow error: ${String((err as any)?.message || err)}` }, status: "ERROR" });
          }
        }

        // delivery statuses
        for (const s of statuses) {
          const id = s.id as string | undefined;
          const status = s.status as string | undefined;
          if (id && status) await updateStatusByWamid(id, status.toUpperCase());
        }
      }
    }
  } catch (e: any) {
    await logOutbound({ direction: "in", payload: { error: e?.message || String(e) }, status: "ERROR" });
  }

  // Always 200 to prevent retries storm
  return NextResponse.json({ ok: true });
}
