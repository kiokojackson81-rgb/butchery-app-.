import { prisma } from "@/lib/prisma";
import { sendText, sendInteractive, sendTemplate, logOutbound } from "@/lib/wa";
import { composeWaMessage, OpsContext } from "@/lib/ai_util";
import { safeSendGreetingOrMenu } from "@/lib/wa_attendant_flow";
// GPT/OOC removed — use simple legacy fallbacks
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
  const to = toE164.startsWith("+") ? toE164 : "+" + toE164;

  // If outside the 24h window: send ops_role_notice (or WA_TEMPLATE_OPS_ROLE_NOTICE) to reopen
  let stale = true;
  let reopenedSent = false;
  try {
    const at = await lastInboundAt(to);
    stale = minutesSince(at) > 24 * 60; // strictly 24h for template reopen
  } catch { stale = true; }

  // Always ensure we have a login deep link handy for unauthenticated flows
  let deepLink: string | null = null;
  try { deepLink = (await createLoginLink(to)).url; } catch { deepLink = null; }

  if (stale) {
    const p2 = deepLink || (process.env.APP_ORIGIN || "https://barakafresh.com") + "/login";
    // Choose template by context so login reads exactly as our in-session copy
    const isLogin = ctx?.kind === "login_prompt";
    const template = isLogin
      ? (process.env.WA_TEMPLATE_LOGIN_NAME || "login_text_link_v1")
      : (process.env.WA_TEMPLATE_OPS_ROLE_NOTICE || "ops_role_notice");
    const params = isLogin
      ? [p2] // Template body should be: "You're not logged in. Open {{1}} to continue."
      : ["BarakaOps needs your attention", p2];

    // Throttle: ReminderSend unique per day/phone/type (separate types per template)
    const today = new Date();
    const keyDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const type = isLogin ? "login_text_link_v1" : "ops_role_notice_v1";
    const exists = await (prisma as any).reminderSend
      .findUnique({ where: { type_phoneE164_date: { type, phoneE164: to, date: keyDate } } })
      .catch(() => null);
    if (!exists) {
      try {
        await sendTemplate({ to, template, params, contextType: "TEMPLATE_REOPEN" });
        reopenedSent = true;
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
        const role = (ctx as any).role as string;
        const outlet = (ctx as any).outlet || undefined;
        await safeSendGreetingOrMenu({
          phone: to,
          role,
          outlet,
          force: true,
          source: "dispatcher_login_welcome",
          sessionLike: role === "attendant" ? { outlet } : undefined,
        });
        try { await logOutbound({ direction: "out", templateName: null, payload: { phoneE164: to, ctx }, status: "SENT", type: "MENU_SEND" }); } catch {}
        result = { ok: true };
      } else if (ctx.kind === "login_prompt") {
        // If we just sent a template to reopen, avoid a second follow-up; single message policy
        if (stale && reopenedSent) {
          result = { ok: true, reopened: true } as any;
          return result;
        }
        // Single concise text with deep link; avoid multi-message spam
        const deep = deepLink || (process.env.APP_ORIGIN || "https://barakafresh.com") + "/login";
        try {
          await sendText(to, `You're not logged in. Open ${deep} to continue.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
          await logOutbound({ direction: "out", templateName: null, payload: { phoneE164: to, ctx }, status: "SENT", type: "MENU_SEND" });
          result = { ok: true };
        } catch {}
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



