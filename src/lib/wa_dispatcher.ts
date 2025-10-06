// src/lib/wa_dispatcher.ts
import { prisma } from "@/lib/prisma";
import { sendTemplate, sendText, sendInteractive, logOutbound } from "@/lib/wa";
import { composeWaMessage, OpsContext } from "@/lib/ai_util";
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
  const ttl = Number(process.env.WA_SESSION_TTL_MIN || 60);
  const to = toE164.startsWith("+") ? toE164 : "+" + toE164;

  // If outside the 24h window: send ops_nudge template first to reopen
  let stale = true;
  try {
    const at = await lastInboundAt(to);
    stale = minutesSince(at) > ttl;
  } catch { stale = true; }

  // Always ensure we have a login deep link handy for unauthenticated flows
  let deepLink: string | null = null;
  try { deepLink = (await createLoginLink(to)).url; } catch { deepLink = null; }

  if (stale) {
    const name = process.env.WA_TEMPLATE_NAME || "ops_nudge";
    const p1 = "BarakaOps needs your attention";
    const p2 = deepLink || (process.env.APP_ORIGIN || "https://barakafresh.com") + "/login";
    try { await sendTemplate({ to, template: name, params: [p1, p2], contextType: "TEMPLATE_REOPEN" }); } catch {}
  }

  // Compose GPT message
  const composed = await composeWaMessage(ctx, { deepLink: deepLink || undefined });

  let result: any = null;
  if (composed.interactive) {
    result = await sendInteractive(composed.interactive, "AI_DISPATCH_INTERACTIVE");
  } else if (composed.text) {
    result = await sendText(to, composed.text, "AI_DISPATCH_TEXT");
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
