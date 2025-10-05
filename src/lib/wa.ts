// src/lib/wa.ts
// WhatsApp Cloud (Meta Graph API) transport with optional dry-run.

import { prisma } from "@/lib/prisma";

// Treat any non-production environment as dry-run by default to simplify local dev.
// Still allow explicit WA_DRY_RUN=true in production-like envs for safety tests.
const DRY = (process.env.WA_DRY_RUN === "true") || (process.env.NODE_ENV !== "production");

const GRAPH_BASE = "https://graph.facebook.com/v20.0";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function normalizeGraphPhone(to: string): string {
  // Graph API expects E.164 without leading '+'
  return String(to || "").replace(/[^0-9+]/g, "").replace(/^\+/, "");
}

export type SendResult = { ok: true; waMessageId?: string; response?: any } | { ok: false; error: string };

export async function sendTemplate(opts: {
  to: string;
  template: string;
  params?: string[];
  langCode?: string;
}) {
  const toNorm = normalizeGraphPhone(opts.to);
  const phoneE164 = toNorm ? `+${toNorm}` : String(opts.to || "");
  if (DRY) {
    const waMessageId = `DRYRUN-${Date.now()}`;
    await logOutbound({ direction: "out", templateName: opts.template, payload: { meta: { phoneE164 }, request: { via: "dry-run", ...opts } }, waMessageId, status: "SENT" });
    return { ok: true, waMessageId, response: { dryRun: true } } as const;
  }

  const phoneId = requiredEnv("WHATSAPP_PHONE_NUMBER_ID");
  const token = requiredEnv("WHATSAPP_TOKEN");
  const lang = opts.langCode || "en";
  const to = toNorm;

  const body: any = {
    messaging_product: "whatsapp",
    to,
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
    await logOutbound({ direction: "out", templateName: opts.template, payload: { meta: { phoneE164 }, request: body, response: json, status: res.status }, status: "ERROR" });
    throw new Error(`WA send failed: ${res.status}`);
  }

  const waMessageId = json?.messages?.[0]?.id as string | undefined;
  await logOutbound({ direction: "out", templateName: opts.template, payload: { meta: { phoneE164 }, request: body, response: json }, waMessageId, status: "SENT" });
  return { ok: true, waMessageId, response: json } as const;
}

/**
 * Attempt to warm up a business-initiated session by sending a lightweight template.
 * If DRY, no-op. Best effort: swallow errors so callers can proceed to send menus.
 */
export async function warmUpSession(to: string): Promise<boolean> {
  try {
    if (DRY) return true;
    // Use configurable template name; default to common "hello_world".
    // To disable warm-up entirely, set WHATSAPP_WARMUP_TEMPLATE to "none" or empty.
    const tmpl = (process.env.WHATSAPP_WARMUP_TEMPLATE ?? "hello_world").trim();
    if (!tmpl || tmpl.toLowerCase() === "none") return true;
    const res = await sendTemplate({ to, template: tmpl });
    return (res as any)?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Send plain text over WhatsApp.
 */
export async function sendText(to: string, text: string): Promise<SendResult> {
  const toNorm = normalizeGraphPhone(to);
  const phoneE164 = toNorm ? `+${toNorm}` : String(to || "");
  if (DRY) {
    const waMessageId = `DRYRUN-${Date.now()}`;
    await logOutbound({ direction: "out", templateName: null, payload: { meta: { phoneE164 }, via: "dry-run", text }, waMessageId, status: "SENT" });
    return { ok: true, waMessageId, response: { dryRun: true } } as const;
  }

  const phoneId = requiredEnv("WHATSAPP_PHONE_NUMBER_ID");
  const token = requiredEnv("WHATSAPP_TOKEN");
  const body = {
    messaging_product: "whatsapp",
    to: toNorm,
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
    await logOutbound({ direction: "out", templateName: null, payload: { meta: { phoneE164 }, request: body, response: json, status: res.status }, status: "ERROR" });
    return { ok: false, error: `WA text failed: ${res.status}` } as const;
  }
  const waMessageId = (json as any)?.messages?.[0]?.id as string | undefined;
  await logOutbound({ direction: "out", templateName: null, payload: { meta: { phoneE164 }, request: body, response: json }, waMessageId, status: "SENT" });
  return { ok: true, waMessageId, response: json } as const;
}

/** Send a generic interactive message body (list/buttons) */
export async function sendInteractive(body: any): Promise<SendResult> {
  const toNorm = normalizeGraphPhone(body?.to || "");
  const phoneE164 = toNorm ? `+${toNorm}` : String(body?.to || "");
  if (DRY) {
    const waMessageId = `DRYRUN-${Date.now()}`;
    await logOutbound({ direction: "out", templateName: null, payload: { meta: { phoneE164 }, via: "dry-run", body }, waMessageId, status: "SENT" });
    return { ok: true, waMessageId, response: { dryRun: true } } as const;
  }

  const phoneId = requiredEnv("WHATSAPP_PHONE_NUMBER_ID");
  const token = requiredEnv("WHATSAPP_TOKEN");
  const normalized = { ...body, to: toNorm };
  const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(phoneId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(normalized),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    await logOutbound({ direction: "out", templateName: null, payload: { meta: { phoneE164 }, request: normalized, response: json, status: res.status }, status: "ERROR" });
    return { ok: false, error: `WA interactive failed: ${res.status}` } as const;
  }
  const waMessageId = (json as any)?.messages?.[0]?.id as string | undefined;
  await logOutbound({ direction: "out", templateName: null, payload: { meta: { phoneE164 }, request: normalized, response: json }, waMessageId, status: "SENT" });
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

/** Resolve a phone for a given role/code/outlet using PhoneMapping */
export async function getPhoneByCode(opts: { role: string; code?: string; outlet?: string }) {
  const where: any = { role: opts.role };
  if (opts.code) where.code = opts.code;
  if (opts.outlet) where.outlet = opts.outlet;
  const m = await (prisma as any).phoneMapping.findFirst({ where });
  return m?.phoneE164 || null;
}

