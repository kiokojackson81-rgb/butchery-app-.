// src/lib/wa.ts
// WhatsApp Cloud (Meta Graph API) transport with optional dry-run.

import { prisma } from "@/lib/prisma";
import { logMessage } from "@/lib/wa_log";

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

// Simple 10s cache for window checks
const windowCache = new Map<string, { at: number; open: boolean }>();

async function isWindowOpen(phoneE164: string): Promise<boolean> {
  // In DRY/dev mode, avoid any DB lookups to determine session window state.
  // Assume open to prevent reopen template sends and keep local tests snappy.
  try {
    if (DRY) {
      const now = Date.now();
      windowCache.set(phoneE164, { at: now, open: true });
      return true;
    }
  } catch {}
  try {
    const now = Date.now();
    const cached = windowCache.get(phoneE164);
    if (cached && now - cached.at < 10_000) return cached.open;
    const noPlus = phoneE164.replace(/^\+/, "");
    // Consider multiple shapes: meta.phoneE164, payload.phone, and Graph 'from'
    const rows = await (prisma as any).$queryRawUnsafe(
      `SELECT MAX("createdAt") AS last_in
       FROM "WaMessageLog"
       WHERE direction='in' AND (
         payload->'meta'->>'phoneE164' = $1 OR payload->>'phone' = $1 OR payload->>'from' = $2
       )`,
      phoneE164,
      noPlus
    );
    const last = Array.isArray(rows) && rows[0] ? (rows[0] as any).last_in : null;
    const lastTs = last ? new Date(last).getTime() : 0;
    const open = lastTs > 0 && (now - lastTs) <= 24 * 60 * 60 * 1000;
    windowCache.set(phoneE164, { at: now, open });
    return open;
  } catch {
    return false;
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function sendTemplate(opts: {
  to: string;
  template: string;
  params?: string[];
  langCode?: string;
  contextType?: string; // e.g., ASSIGNMENT | REMINDER | TEMPLATE_OUTBOUND
  meta?: Record<string, any>;
}) {
  // Feature-flag legacy senders: allow through only AI dispatcher and reopen templates
  const autosend = process.env.WA_AUTOSEND_ENABLED === "true";
  const allowedContext = ["AI_DISPATCH_TEXT", "AI_DISPATCH_INTERACTIVE", "TEMPLATE_REOPEN"];
  if (!autosend && opts.contextType && !allowedContext.includes(opts.contextType)) {
    const toNorm = normalizeGraphPhone(opts.to);
    const phoneE164 = toNorm ? `+${toNorm}` : String(opts.to || "");
    const waMessageId = `NOOP-${Date.now()}`;
    await logOutbound({ direction: "out", templateName: opts.template, payload: { phone: phoneE164, meta: { phoneE164, reason: "autosend.disabled.context" }, request: { via: "feature-flag-noop", ...opts } }, waMessageId, status: "NOOP", type: "NO_AI_DISPATCH_CONTEXT" });
    return { ok: true, waMessageId, response: { noop: true } } as const;
  }
  const toNorm = normalizeGraphPhone(opts.to);
  const phoneE164 = toNorm ? `+${toNorm}` : String(opts.to || "");
  // If running in GPT-only mode, mark these as gpt_sent so strict transport
  // filters (WA_STRICT_GPT_ONLY) won't block them. Also propagate any caller
  // meta through the logged payload.
  const runningGptOnly = String(process.env.WA_GPT_ONLY || "").toLowerCase() === "true";
  if (DRY) {
    const waMessageId = `DRYRUN-${Date.now()}`;
  await logOutbound({ direction: "out", templateName: opts.template, payload: { phone: phoneE164, meta: { phoneE164, _type: opts.contextType || "TEMPLATE_OUTBOUND", ...(opts.meta || {}), ...(runningGptOnly ? { gpt_sent: true } : {}) }, request: { via: "dry-run", ...opts } }, waMessageId, status: "SENT", type: opts.contextType || "TEMPLATE_OUTBOUND" });
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
  await logOutbound({ direction: "out", templateName: opts.template, payload: { phone: phoneE164, meta: { phoneE164, _type: opts.contextType || "TEMPLATE_OUTBOUND", ...(opts.meta || {}) }, request: body, response: json, status: res.status }, status: "ERROR", type: opts.contextType || "TEMPLATE_OUTBOUND" });
    throw new Error(`WA send failed: ${res.status}`);
  }

  const waMessageId = json?.messages?.[0]?.id as string | undefined;
  await logOutbound({ direction: "out", templateName: opts.template, payload: { phone: phoneE164, meta: { phoneE164, _type: opts.contextType || "TEMPLATE_OUTBOUND", ...(opts.meta || {}), ...(runningGptOnly ? { gpt_sent: true } : {}) }, request: body, response: json }, waMessageId, status: "SENT", type: opts.contextType || "TEMPLATE_OUTBOUND" });
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
async function _sendTextRaw(to: string, text: string, contextType?: string, inReplyTo?: string): Promise<SendResult> {
  // Feature-flag legacy senders: allow AI dispatcher paths only
  const autosend = process.env.WA_AUTOSEND_ENABLED === "true";
  const allowedContext = ["AI_DISPATCH_TEXT", "AI_DISPATCH_INTERACTIVE", "TEMPLATE_REOPEN"];
  if (!autosend && (!contextType || !allowedContext.includes(contextType))) {
    const toNorm = normalizeGraphPhone(to);
    const phoneE164 = toNorm ? `+${toNorm}` : String(to || "");
    const waMessageId = `NOOP-${Date.now()}`;
    await logOutbound({ direction: "out", templateName: null, payload: { phone: phoneE164, in_reply_to: inReplyTo || null, meta: { phoneE164, reason: "autosend.disabled.context", _type: contextType || "AI_DISPATCH_TEXT" }, via: "feature-flag-noop", text }, waMessageId, status: "NOOP", type: "NO_AI_DISPATCH_CONTEXT" });
    return { ok: true, waMessageId, response: { noop: true } } as const;
  }
  const toNorm = normalizeGraphPhone(to);
  const phoneE164 = toNorm ? `+${toNorm}` : String(to || "");
  const runningGptOnly = String(process.env.WA_GPT_ONLY || "").toLowerCase() === "true";
  if (DRY) {
    const waMessageId = `DRYRUN-${Date.now()}`;
    await logOutbound({ direction: "out", templateName: null, payload: { phone: phoneE164, in_reply_to: inReplyTo || null, meta: { phoneE164, _type: contextType || "AI_DISPATCH_TEXT", ...(runningGptOnly ? { gpt_sent: true } : {}) }, via: "dry-run", text }, waMessageId, status: "SENT", type: contextType || "AI_DISPATCH_TEXT" });
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
    await logOutbound({ direction: "out", templateName: null, payload: { phone: phoneE164, in_reply_to: inReplyTo || null, meta: { phoneE164, _type: contextType || "AI_DISPATCH_TEXT", ...(runningGptOnly ? { gpt_sent: true } : {}) }, request: body, response: json, status: res.status }, status: "ERROR", type: contextType || "AI_DISPATCH_TEXT" });
    return { ok: false, error: `WA text failed: ${res.status}` } as const;
  }
  const waMessageId = (json as any)?.messages?.[0]?.id as string | undefined;
  await logOutbound({ direction: "out", templateName: null, payload: { phone: phoneE164, in_reply_to: inReplyTo || null, meta: { phoneE164, _type: contextType || "AI_DISPATCH_TEXT", ...(runningGptOnly ? { gpt_sent: true } : {}) }, request: body, response: json }, waMessageId, status: "SENT", type: contextType || "AI_DISPATCH_TEXT" });
  return { ok: true, waMessageId, response: json } as const;
}

/** Send a generic interactive message body (list/buttons) */
async function _sendInteractiveRaw(body: any, contextType?: string, inReplyTo?: string): Promise<SendResult> {
  // Feature-flag legacy senders: allow AI dispatcher paths only
  const autosend = process.env.WA_AUTOSEND_ENABLED === "true";
  const allowedContext = ["AI_DISPATCH_TEXT", "AI_DISPATCH_INTERACTIVE", "TEMPLATE_REOPEN"];
  if (!autosend && (!contextType || !allowedContext.includes(contextType))) {
    const toNorm = normalizeGraphPhone(body?.to || "");
    const phoneE164 = toNorm ? `+${toNorm}` : String(body?.to || "");
    const waMessageId = `NOOP-${Date.now()}`;
    await logOutbound({ direction: "out", templateName: null, payload: { phone: phoneE164, in_reply_to: inReplyTo || null, meta: { phoneE164, reason: "autosend.disabled.context", _type: contextType || "AI_DISPATCH_INTERACTIVE" }, via: "feature-flag-noop", body }, waMessageId, status: "NOOP", type: "NO_AI_DISPATCH_CONTEXT" });
    return { ok: true, waMessageId, response: { noop: true } } as const;
  }
  // Respect explicit feature flag for interactive payloads. When disabled,
  // construct a readable plain-text fallback so users still receive guidance
  // and our logs show a SENT message instead of a silent NOOP.
  if (process.env.WA_INTERACTIVE_ENABLED !== "true") {
    const toNorm = normalizeGraphPhone(body?.to || "");
    const phoneE164 = toNorm ? `+${toNorm}` : String(body?.to || "");
    // Build a compact fallback text from the interactive payload
    let header = "Choose an option:";
    try { header = String(body?.interactive?.body?.text || header); } catch {}
    let lines: string[] = [];
    try {
      const itype = String(body?.interactive?.type || "").toLowerCase();
      if (itype === "button") {
        const buttons = Array.isArray(body?.interactive?.action?.buttons) ? body.interactive.action.buttons : [];
        lines = buttons.slice(0, 10).map((b: any, i: number) => `${i + 1}) ${((b || {}).reply || {}).title || ((b || {}).title) || "Option"}`);
      } else if (itype === "list") {
        const sections = Array.isArray(body?.interactive?.action?.sections) ? body.interactive.action.sections : [];
        const rows = sections.flatMap((s: any) => Array.isArray(s?.rows) ? s.rows : []);
        lines = rows.slice(0, 10).map((r: any, i: number) => `${i + 1}) ${String(r?.title || r?.id || "Option")} ${r?.description ? `- ${r.description}` : ""}`.trim());
      }
    } catch {}
    const fallback = [header, ...(lines.length ? lines : [])].join("\n").trim();
    try {
      await logOutbound({ direction: 'out', templateName: null, payload: { phone: phoneE164, in_reply_to: inReplyTo || null, meta: { phoneE164, reason: 'interactive.disabled.fallback', _type: contextType || 'AI_DISPATCH_INTERACTIVE' }, original_body: body }, status: 'WARN', type: 'SEND_INTERACTIVE_FALLBACK' });
    } catch {}
    // Send the text fallback within the same context type so feature flags allow it
    return _sendTextRaw(toNorm, fallback || header, contextType, inReplyTo);
  }
  const toNorm = normalizeGraphPhone(body?.to || "");
  const phoneE164 = toNorm ? `+${toNorm}` : String(body?.to || "");
  const runningGptOnly = String(process.env.WA_GPT_ONLY || "").toLowerCase() === "true";
  // Defensive: WhatsApp buttons payloads are limited to max 3 buttons.
  // If a builder accidentally produces >3 buttons, convert to a plain text
  // fallback to avoid Graph errors and record the fallback in logs.
  try {
    const buttons = body?.interactive?.action?.buttons;
    if (Array.isArray(buttons) && buttons.length > 3) {
      // Build a readable text fallback listing options and send as text instead
      const titles = buttons.map((b: any, i: number) => `${i + 1}) ${((b || {}).reply || {}).title || ((b || {}).title) || 'Option'}`);
      const fallback = `${(body?.interactive?.body?.text) || 'Choose an option:'}\n${titles.join('\n')}`;
      try { await logOutbound({ direction: 'out', templateName: null, payload: { phone: phoneE164, meta: { phoneE164, reason: 'interactive.too_many_buttons', buttonsCount: buttons.length }, request: body }, status: 'WARN', type: 'SEND_INTERACTIVE_FALLBACK' }); } catch {}
      // Send as plain text instead of interactive to avoid API 131009
      return _sendTextRaw(toNorm, fallback, contextType, inReplyTo);
    }
  } catch (e) {
    // swallow; best-effort only
  }
  if (DRY) {
    const waMessageId = `DRYRUN-${Date.now()}`;
    // Ensure phoneE164 is present under meta for test filters
    await logOutbound({ direction: "out", templateName: null, payload: { phone: phoneE164, in_reply_to: inReplyTo || null, meta: { phoneE164, _type: contextType || "AI_DISPATCH_INTERACTIVE", ...(runningGptOnly ? { gpt_sent: true } : {}) }, via: "dry-run", body }, waMessageId, status: "SENT", type: contextType || "AI_DISPATCH_INTERACTIVE" });
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
    await logOutbound({ direction: "out", templateName: null, payload: { phone: phoneE164, in_reply_to: inReplyTo || null, meta: { phoneE164, _type: contextType || "AI_DISPATCH_INTERACTIVE", ...(runningGptOnly ? { gpt_sent: true } : {}) }, request: normalized, response: json, status: res.status }, status: "ERROR", type: contextType || "AI_DISPATCH_INTERACTIVE" });
    return { ok: false, error: `WA interactive failed: ${res.status}` } as const;
  }
  const waMessageId = (json as any)?.messages?.[0]?.id as string | undefined;
  await logOutbound({ direction: "out", templateName: null, payload: { phone: phoneE164, in_reply_to: inReplyTo || null, meta: { phoneE164, _type: contextType || "AI_DISPATCH_INTERACTIVE", ...(runningGptOnly ? { gpt_sent: true } : {}) }, request: normalized, response: json }, waMessageId, status: "SENT", type: contextType || "AI_DISPATCH_INTERACTIVE" });
  return { ok: true, waMessageId, response: json } as const;
}

export async function sendWithReopen(opts: {
  toE164: string;
  kind: "text" | "interactive";
  text?: string;
  body?: any;
  ctxType: "AI_DISPATCH_TEXT" | "AI_DISPATCH_INTERACTIVE";
  inReplyTo?: string;
}): Promise<SendResult> {
  const to = opts.toE164;
  const open = await isWindowOpen(to);
  if (!open) {
    // Attempt to reopen using configured template
    try {
      const tmpl = (process.env.WA_TEMPLATE_NAME || "ops_role_notice").trim();
      await logOutbound({ direction: "out", templateName: tmpl, payload: { phone: to, meta: { phoneE164: to, reopen_reason: "window_closed", _type: "TEMPLATE_REOPEN_ATTEMPT" } }, status: "INFO", type: "TEMPLATE_REOPEN_ATTEMPT" });
      await sendTemplate({ to, template: tmpl, contextType: "TEMPLATE_REOPEN" });
      await sleep(250);
    } catch {
      // proceed anyway; the next send may fail if window remained closed
    }
  }
  if (opts.kind === "text") {
    return _sendTextRaw(to, opts.text || "", opts.ctxType, opts.inReplyTo);
  } else {
    const body = { ...(opts.body || {}), to: normalizeGraphPhone(to) };
    return _sendInteractiveRaw(body, opts.ctxType, opts.inReplyTo);
  }
}

export async function sendText(to: string, text: string, contextType?: string, meta?: { inReplyTo?: string; gpt_sent?: boolean }): Promise<SendResult> {
  const ctx = (contextType as any) || "AI_DISPATCH_TEXT";
  // Strict enforcement: if enabled, only allow text sends that are explicitly
  // marked as originating from GPT (meta.gpt_sent === true).
  const STRICT = String(process.env.WA_STRICT_GPT_ONLY || "").toLowerCase() === "true";
  if (STRICT && !(meta && (meta as any).gpt_sent === true)) {
    // Backwards-compatibility / developer convenience: many server-side
    // AI dispatch paths already set contextType to AI_DISPATCH_TEXT or
    // AI_DISPATCH_INTERACTIVE. Treat those contexts as implicitly GPT-originated
    // when strict mode is enabled so we don't need to annotate every call site.
    const implicitAiContext = ctx === "AI_DISPATCH_TEXT" || ctx === "AI_DISPATCH_INTERACTIVE";
    if (!implicitAiContext) {
    const toNorm = normalizeGraphPhone(to);
    const phoneE164 = toNorm ? `+${toNorm}` : String(to || "");
    const waMessageId = `NOOP-${Date.now()}`;
    try { await logOutbound({ direction: 'out', templateName: null, payload: { phone: phoneE164, meta: { phoneE164, reason: 'strict_gpt_only.blocked', requestedContext: ctx } , request: { to, text } }, waMessageId, status: 'NOOP', type: 'STRICT_GPT_BLOCK' }); } catch {}
    return { ok: true, waMessageId, response: { noop: true } } as const;
    }
  }
  return sendWithReopen({ toE164: to.startsWith("+") ? to : "+" + to, kind: "text", text, ctxType: ctx, inReplyTo: meta?.inReplyTo });
}

/** Send a generic interactive message body (list/buttons) */
export async function sendInteractive(body: any, contextType?: string, meta?: { inReplyTo?: string }): Promise<SendResult> {
  const ctx = (contextType as any) || "AI_DISPATCH_INTERACTIVE";
  const toRaw = body?.to || "";
  const to = String(toRaw || "");
  const e164 = to.startsWith("+") ? to : "+" + to;
  return sendWithReopen({ toE164: e164, kind: "interactive", body, ctxType: ctx, inReplyTo: meta?.inReplyTo });
}

/**
 * Safe wrappers that callers should prefer. They centralize error logging and
 * ensure failures are recorded via logOutbound so callers can still mark sent-state.
 */
export async function sendTextSafe(to: string, text: string, contextType?: string, meta?: { inReplyTo?: string; gpt_sent?: boolean }) {
  try {
    const res = await sendText(to, text, contextType, meta);
    if (!res.ok) {
      try { await logOutbound({ direction: 'out', templateName: null, payload: { phone: to, in_reply_to: meta?.inReplyTo || null, meta: { phoneE164: to, send_error: res.error } }, status: 'ERROR', type: 'SEND_TEXT_FAIL' }); } catch {}
    }
    return res;
  } catch (e: any) {
    try { await logOutbound({ direction: 'out', templateName: null, payload: { phone: to, in_reply_to: meta?.inReplyTo || null, meta: { phoneE164: to, send_error: String(e) } }, status: 'ERROR', type: 'SEND_TEXT_EXCEPTION' }); } catch {}
    return { ok: false, error: String(e) } as SendResult;
  }
}

export async function sendInteractiveSafe(body: any, contextType?: string, meta?: { inReplyTo?: string }) {
  try {
    const res = await sendInteractive(body, contextType, meta);
    const to = body?.to || (meta && (meta as any).to) || '';
    if (!res.ok) {
      try { await logOutbound({ direction: 'out', templateName: null, payload: { phone: to, in_reply_to: meta?.inReplyTo || null, meta: { phoneE164: to, send_error: res.error } }, status: 'ERROR', type: 'SEND_INTERACTIVE_FAIL' }); } catch {}
    }
    return res;
  } catch (e: any) {
    const to = body?.to || (meta && (meta as any).to) || '';
    try { await logOutbound({ direction: 'out', templateName: null, payload: { phone: to, in_reply_to: meta?.inReplyTo || null, meta: { phoneE164: to, send_error: String(e) } }, status: 'ERROR', type: 'SEND_INTERACTIVE_EXCEPTION' }); } catch {}
    return { ok: false, error: String(e) } as SendResult;
  }
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
  type?: string | null;
}) {
  try {
    const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
    const LOG_DRY = String(process.env.WA_LOG_DRY_RUN || "").toLowerCase() === "true";
    if (DRY && !LOG_DRY) return; // skip DB logging in DRY mode unless explicitly enabled
    await logMessage({
      attendantId: entry.attendantId ?? null,
      direction: entry.direction ?? "out",
      templateName: entry.templateName ?? null,
      payload: entry.payload,
      waMessageId: entry.waMessageId ?? null,
      status: entry.status ?? null,
      type: entry.type ?? null,
    });
  } catch {}
}

export async function updateStatusByWamid(waMessageId: string, status: string) {
  try {
    const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
    if (DRY) return; // skip in DRY mode
    // Use updateMany to avoid throwing when the waMessageId does not match any row.
    const res: any = await (prisma as any).waMessageLog.updateMany({ where: { waMessageId }, data: { status } }).catch(() => ({ count: 0 }));
    const count = (res && typeof res.count === 'number') ? res.count : 0;
    if (count === 0) {
      try { await logOutbound({ direction: 'in', payload: { waMessageId, status }, status: 'WARN', type: 'WEBHOOK_MISSING_WAMID' }); } catch {}
    } else {
      try { await logOutbound({ direction: 'in', payload: { waMessageId, status }, status: 'OK', type: 'WEBHOOK_STATUS_UPDATE' }); } catch {}
    }
  } catch (e: any) {
    try { await logOutbound({ direction: 'in', payload: { waMessageId, status, error: String(e) }, status: 'ERROR', type: 'WEBHOOK_STATUS_UPDATE_FAIL' }); } catch {}
  }
}

/** Resolve a phone for a given role/code/outlet using PhoneMapping */
export async function getPhoneByCode(opts: { role: string; code?: string; outlet?: string }) {
  const where: any = { role: opts.role };
  if (opts.code) where.code = opts.code;
  if (opts.outlet) where.outlet = opts.outlet;
  const m = await (prisma as any).phoneMapping.findFirst({ where });
  return m?.phoneE164 || null;
}

