// src/lib/wa_dispatcher.ts
import { prisma } from "@/lib/prisma";
import { sendTemplate, sendText, sendInteractive, logOutbound } from "@/lib/wa";
import { composeWaMessage, OpsContext } from "@/lib/ai_util";
import { menuMain } from "@/lib/wa_messages";
import { sendGptGreeting } from "@/lib/wa_gpt_helpers";
import { sendCanonicalTabs } from "@/lib/wa_tabs";
import { buildAuthenticatedReply, buildUnauthenticatedReply } from "@/lib/ooc_parse";
import { createLoginLink } from "@/server/wa_links";

function minutesSince(date?: Date | string | null): number {
  if (!date) return Infinity;
  const t = typeof date === "string" ? new Date(date).getTime() : (date as Date).getTime();
  return (Date.now() - t) / 60000;
}

async function lastInboundAt(phoneE164: string): Promise<Date | null> {
  try {
    const sess = await (prisma as any).waSession.findFirst({ where: { phoneE164 } });
    const fromSess = (sess?.updatedAt as Date | undefined) || null;
    const msg = await (prisma as any).waMessageLog.findFirst({
      where: { direction: "in", payload: { path: ["from"], equals: phoneE164.replace(/^\+/, "") } as any },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }).catch(() => null);
    const fromLog = (msg?.createdAt as Date | undefined) || null;
    return (fromLog && fromSess) ? (fromLog > fromSess ? fromLog : fromSess) : (fromLog || fromSess);
  } catch {
    return null;
  }
}

export async function sendOpsMessage(toE164: string, ctx: OpsContext) {
  const ttlMin = Number(process.env.WA_SESSION_TTL_MIN || 60);
  const to = toE164.startsWith("+") ? toE164 : "+" + toE164;

  // If outside the 24h window: send ops_role_notice (or WA_TEMPLATE_NAME) to reopen
  let stale = true;
  try {
    const at = await lastInboundAt(to);
    stale = minutesSince(at) > 24 * 60; // strictly 24h for template reopen
  } catch { stale = true; }

  // Always ensure we have a login deep link handy for unauthenticated flows
  let deepLink: string | null = null;
  try { deepLink = (await createLoginLink(to)).url; } catch { deepLink = null; }

  if (stale) {
  const name = process.env.WA_TEMPLATE_NAME || "ops_role_notice";
    const p1 = "BarakaOps needs your attention";
    const p2 = deepLink || (process.env.APP_ORIGIN || "https://barakafresh.com") + "/login";
    // Throttle: ReminderSend unique per day/phone/type
    const today = new Date();
    const keyDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const type = "ops_role_notice_v1";
    const exists = await (prisma as any).reminderSend.findUnique({ where: { type_phoneE164_date: { type, phoneE164: to, date: keyDate } } }).catch(() => null);
    if (!exists) {
      try {
        await sendTemplate({ to, template: name, params: [p1, p2], contextType: "TEMPLATE_REOPEN" });
        await (prisma as any).reminderSend.create({ data: { type, phoneE164: to, date: keyDate } });
      } catch {}
    }
  }

  // Compose GPT message
  const composed = await composeWaMessage(ctx, { deepLink: deepLink || undefined });

  let result: any = null;

  // Special-case interactive builders for login flows to reduce typing
  try {
    if (process.env.WA_INTERACTIVE_ENABLED === "true") {
      if (ctx.kind === "login_welcome") {
        // Send role-specific interactive menu then send only the human text (no OOC)
        const role = (ctx as any).role as string;
        const built = buildAuthenticatedReply(role as any, (ctx as any).outlet || undefined);
  // Send a GPT-generated greeting; also send canonical tabs for parity
  await sendGptGreeting(to, role, (ctx as any).outlet || undefined);
  try { await sendCanonicalTabs(to, role as any, (ctx as any).outlet || undefined); } catch {}
          // Send human-facing text only (mark as GPT-originated for strict mode)
          try { await sendText(to, built.text, "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
        // Log the OOC for observability (do not expose to user)
        try { await logOutbound({ direction: "out", templateName: null, payload: { phoneE164: to, ctx, ooc: built.ooc }, status: "SENT", type: "OOC_LEGACY" }); } catch {}
        result = { ok: true };
      } else if (ctx.kind === "login_prompt") {
        // Send a compact interactive button prompting to open the deep link, then send only the human text (no OOC)
        const deep = deepLink || (process.env.APP_ORIGIN || "https://barakafresh.com") + "/login";
        const payload = {
          messaging_product: "whatsapp",
          to,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: `Please sign in to continue.` },
            action: {
              buttons: [
                { type: "reply", reply: { id: "SEND_LOGIN_LINK", title: "LOGIN" } },
                { type: "reply", reply: { id: "HELP", title: "HELP" } },
              ],
            },
          },
        };
        try { await sendInteractive(payload as any, "AI_DISPATCH_INTERACTIVE"); } catch { }
        const built = buildUnauthenticatedReply(deep, false);
          try { await sendText(to, built.text, "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
        try { await logOutbound({ direction: "out", templateName: null, payload: { phoneE164: to, ctx, ooc: built.ooc }, status: "SENT", type: "OOC_LEGACY" }); } catch {}
        result = { ok: true };
      }
    }
  } catch (e) {}

  // Fallback: if not handled above, send composed as before
  if (!result) {
      if (composed.interactive) {
      // If interactive is globally disabled via flag, fall back to a concise text summary
      if (process.env.WA_INTERACTIVE_ENABLED === "true") {
        result = await sendInteractive(composed.interactive, "AI_DISPATCH_INTERACTIVE");
      } else {
        const summary = composed.text || "Please open the Main Menu to proceed.";
        result = await sendText(to, summary, "AI_DISPATCH_TEXT", { gpt_sent: true });
      }
    } else if (composed.text) {
        // Composed.text often comes from the AI; mark it so strict transport allows it
        result = await sendText(to, composed.text, "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
  }

  try {
    await logOutbound({
      direction: "out",
      templateName: null,
      payload: { meta: { phoneE164: to }, ctx, composed },
      waMessageId: (result as any)?.waMessageId ?? null,
      status: (result as any)?.ok ? "SENT" : "ERROR",
      type: "AI_DISPATCH",
    });
  } catch {}

  return result ?? { ok: false, error: "no message composed" };
}

export type { OpsContext };
