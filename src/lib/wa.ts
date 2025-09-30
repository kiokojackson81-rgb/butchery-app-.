// src/lib/wa.ts
// WhatsApp Cloud service with feature-flag fallback to legacy Chatrace helpers.

import { prisma } from "@/lib/db";
import { FLAGS } from "@/lib/flags";
import { chatraceSendText, chatraceSendTemplate } from "@/lib/chatrace";

const GRAPH_BASE = "https://graph.facebook.com/v20.0";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export type SendResult = { ok: true; waMessageId?: string; response?: any } | { ok: false; error: string };

export async function sendTemplate(opts: {
  to: string;
  template: string;
  params?: string[];
  langCode?: string;
}) {
  if (process.env.WA_DRY_RUN === "true") {
    const waMessageId = `DRYRUN-${Date.now()}`;
    await logOutbound({ direction: "out", templateName: opts.template, payload: { request: { via: "dry-run", ...opts } }, waMessageId, status: "SENT" });
    return { ok: true, waMessageId, response: { dryRun: true } } as const;
  }
  if (FLAGS.CHATRACE_ENABLED) {
    // Legacy path: use existing Chatrace integration
    const res = await chatraceSendTemplate(opts.to, opts.template, opts.params || []);
    await logOutbound({ direction: "out", templateName: opts.template, payload: { request: { via: "chatrace", ...opts }, response: res }, waMessageId: (res as any)?.id || null, status: (res as any)?.ok ? "SENT" : "ERROR" });
    if ((res as any)?.ok) return { ok: true, waMessageId: (res as any)?.id } as const;
    return { ok: false, error: (res as any)?.error || "Chatrace send failed" } as const;
  }

  const phoneId = requiredEnv("WHATSAPP_PHONE_NUMBER_ID");
  const token = requiredEnv("WHATSAPP_TOKEN");
  const lang = opts.langCode || "en";

  const body: any = {
    messaging_product: "whatsapp",
    to: opts.to,
    type: "template",
    template: {
      name: opts.template,
      language: { code: lang },
    },
  };

  if (opts.params?.length) {
    body.template.components = [
      { type: "body", parameters: (opts.params || []).map((t) => ({ type: "text", text: String(t) })) },
    ];
  }

  const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(phoneId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    await logOutbound({ direction: "out", templateName: opts.template, payload: { request: body, response: json, status: res.status }, status: "ERROR" });
    throw new Error(`WA send failed: ${res.status}`);
  }

  const waMessageId = json?.messages?.[0]?.id as string | undefined;
  await logOutbound({ direction: "out", templateName: opts.template, payload: { request: body, response: json }, waMessageId, status: "SENT" });
  return { ok: true, waMessageId, response: json } as const;
}

/**
 * Send plain text over WhatsApp.
 */
export async function sendText(to: string, text: string): Promise<SendResult> {
  if (process.env.WA_DRY_RUN === "true") {
    const waMessageId = `DRYRUN-${Date.now()}`;
    await logOutbound({ direction: "out", templateName: null, payload: { via: "dry-run", text }, waMessageId, status: "SENT" });
    return { ok: true, waMessageId, response: { dryRun: true } } as const;
  }
  if (FLAGS.CHATRACE_ENABLED) {
    const res = await chatraceSendText({ to, text });
    await logOutbound({ direction: "out", templateName: null, payload: { via: "chatrace", text, response: res }, waMessageId: (res as any)?.id || null, status: (res as any)?.ok ? "SENT" : "ERROR" });
    if ((res as any)?.ok) return { ok: true, waMessageId: (res as any)?.id } as const;
    return { ok: false, error: (res as any)?.error || "Chatrace send failed" } as const;
  }

  const phoneId = requiredEnv("WHATSAPP_PHONE_NUMBER_ID");
  const token = requiredEnv("WHATSAPP_TOKEN");
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  } as const;

  const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(phoneId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    await logOutbound({ direction: "out", templateName: null, payload: { request: body, response: json, status: res.status }, status: "ERROR" });
    return { ok: false, error: `WA text failed: ${res.status}` } as const;
  }
  const waMessageId = (json as any)?.messages?.[0]?.id as string | undefined;
  await logOutbound({ direction: "out", templateName: null, payload: { request: body, response: json }, waMessageId, status: "SENT" });
  return { ok: true, waMessageId, response: json } as const;
}

/**
 * Compatibility wrapper for existing code using sendWaTemplate(phone, name, lang, components)
 */
export async function sendWaTemplate(
  phone: string,
  templateName: string,
  languageCode: string,
  components: Array<{ type: "body"; parameters: Array<{ type: "text"; text: string }> }>
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const params: string[] = Array.isArray(components)
    ? (components.find((c) => c?.type === "body")?.parameters || []).map((p) => String(p?.text ?? ""))
    : [];
  const res = await sendTemplate({ to: phone, template: templateName, params, langCode: languageCode });
  if ((res as any)?.ok) return { ok: true, id: (res as any)?.waMessageId };
  return { ok: false, error: (res as any)?.error || "send failed" };
}

// Convenience helpers for common notifications (adjust template names to your approved ones)
export async function sendClosingSubmitted(phoneE164: string, attendantName: string, expected: number) {
  const to = phoneE164.replace(/^\+/, "");
  return sendTemplate({ to, template: "closing_stock_submitted", params: [attendantName, String(expected)] });
}

export async function sendSupplyReceived(phoneE164: string, attendantName: string, product: string, qty: number | string) {
  const to = phoneE164.replace(/^\+/, "");
  return sendTemplate({ to, template: "supply_received", params: [attendantName, product, String(qty)] });
}

export async function sendLowStockAlert(phoneE164: string, rendered: string) {
  const to = phoneE164.replace(/^\+/, "");
  return sendTemplate({ to, template: "low_stock_alert", params: [rendered] });
}

export async function logOutbound(entry: {
  attendantId?: string | null;
  templateName?: string | null;
  payload: any;
  waMessageId?: string | null;
  status?: string | null;
  direction?: "in" | "out";
}) {
  try {
    await (prisma as any).waMessageLog.create({
      data: {
        attendantId: entry.attendantId ?? null,
        direction: entry.direction ?? "out",
        templateName: entry.templateName ?? null,
        payload: entry.payload as any,
        waMessageId: entry.waMessageId ?? null,
        status: entry.status ?? null,
      },
    });
  } catch {}
}

export async function updateStatusByWamid(waMessageId: string, status: string) {
  try {
    await (prisma as any).waMessageLog.update({ where: { waMessageId }, data: { status } });
  } catch {}
}

