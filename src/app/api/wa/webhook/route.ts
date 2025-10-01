import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { logOutbound, updateStatusByWamid } from "@/lib/wa";
import { promptWebLogin } from "@/server/wa_gate";
import { ensureAuthenticated, handleAuthenticatedText, handleAuthenticatedInteractive } from "@/server/wa_attendant_flow";

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

        // delivery statuses
        for (const s of statuses) {
          const id = s.id as string | undefined;
          const status = s.status as string | undefined;
          if (id && status) await updateStatusByWamid(id, status.toUpperCase());
        }

        // inbound messages
        for (const m of msgs) {
          const fromGraph = m.from as string | undefined; // 2547...
          const phoneE164 = fromGraph ? `+${fromGraph}` : undefined;
          const type = (m.type as string) || "MESSAGE";
          const wamid = m.id as string | undefined;

          await (prisma as any).waMessageLog.create({
            data: { direction: "in", templateName: null, payload: m as any, waMessageId: wamid || null, status: type },
          }).catch(() => {});

          if (!phoneE164) continue;

          // Helper button: resend login link
          const maybeButtonId = (m as any)?.button?.payload || (m as any)?.button?.text || m?.interactive?.button_reply?.id;
          if (maybeButtonId === "open_login") {
            await promptWebLogin(phoneE164);
            continue;
          }

          const auth = await ensureAuthenticated(phoneE164);
          if (!auth.ok) {
            await promptWebLogin(phoneE164, auth.reason);
            continue;
          }

          if (type === "interactive") {
            const interactiveType = m.interactive?.type as string | undefined;
            const listId = m.interactive?.list_reply?.id as string | undefined;
            const buttonId = m.interactive?.button_reply?.id as string | undefined;
            const id = listId || buttonId || "";
            if (id) await handleAuthenticatedInteractive(auth.sess, id);
            continue;
          }

          if (type === "text") {
            const text = (m.text?.body ?? "").trim();
            await handleAuthenticatedText(auth.sess, text);
            continue;
          }
        }
      }
    }
  } catch (e: any) {
    await logOutbound({ direction: "in", payload: { error: e?.message || String(e) }, status: "ERROR" });
  }

  return NextResponse.json({ ok: true });
}
