import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { logOutbound, updateStatusByWamid } from "@/lib/wa";
import { promptWebLogin } from "@/server/wa_gate";
import { ensureAuthenticated, handleAuthenticatedText, handleAuthenticatedInteractive } from "@/server/wa_attendant_flow";
import { handleSupervisorText, handleSupervisorAction } from "@/server/wa/wa_supervisor_flow";
import { handleSupplierAction, handleSupplierText } from "@/server/wa/wa_supplier_flow";
import { sendText } from "@/lib/wa";
import { runGptForIncoming } from "@/lib/gpt_router";
import { toGraphPhone } from "@/server/canon";

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

        // delivery statuses (Graph callbacks)
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

          // Fast-path: on text and WA_AI_ENABLED, hand off to GPT regardless of auth
          if (type === "text" && String(process.env.WA_AI_ENABLED || "true").toLowerCase() === "true") {
            const text = (m.text?.body ?? "").trim();
            try {
              const reply = await runGptForIncoming(phoneE164, text);
              const r = String(reply || "").trim();
              if (r) await sendText(toGraphPhone(phoneE164), r, "AI_DISPATCH_TEXT");
              continue;
            } catch {
              // fall through to legacy guard
            }
          }

          const auth = await ensureAuthenticated(phoneE164);
          if (!auth.ok) {
            // Universal guard: send login prompt once within a short window
            const tenMinAgo = new Date(Date.now() - 10 * 60_000);
            const recent = await (prisma as any).waMessageLog.findFirst({
              where: {
                status: "LOGIN_PROMPT",
                createdAt: { gt: tenMinAgo },
                payload: { path: ["phone"], equals: phoneE164 } as any,
              },
              select: { id: true },
            }).catch(() => null);
            if (!recent) {
              await logOutbound({ direction: "in", payload: { type: "LOGIN_PROMPT", phone: phoneE164, reason: auth.reason }, status: "LOGIN_PROMPT" });
              await promptWebLogin(phoneE164, auth.reason);
            }
            continue;
          }

          const sessRole = String(auth.sess?.role || "attendant");
          if (type === "interactive") {
            const interactiveType = m.interactive?.type as string | undefined;
            const listId = m.interactive?.list_reply?.id as string | undefined;
            const buttonId = m.interactive?.button_reply?.id as string | undefined;
            const id = listId || buttonId || "";
            if (!id) continue;
            if (sessRole === "supervisor") {
              await handleSupervisorAction(auth.sess, id, phoneE164);
              continue;
            }
            if (sessRole === "supplier") {
              await handleSupplierAction(auth.sess, id, phoneE164);
              continue;
            }
            await handleAuthenticatedInteractive(auth.sess, id);
            continue;
          }

          if (type === "text") {
            const text = (m.text?.body ?? "").trim();
            if (sessRole === "supervisor") {
              await handleSupervisorText(auth.sess, text, phoneE164);
            } else if (sessRole === "supplier") {
              await handleSupplierText(auth.sess, text, phoneE164);
            } else {
              await handleAuthenticatedText(auth.sess, text);
            }
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
