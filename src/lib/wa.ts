// src/lib/wa.ts
// Generic WhatsApp sender via Chatrace with flexible envs.
// This keeps endpoints configurable via envs so we can tweak without redeploying.

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

const TOKEN = process.env.CHATRACE_API_TOKEN || process.env.CHATRACE_API_KEY || "";
const BASE =
  process.env.CHATRACE_BASE_URL || process.env.CHATRACE_BASE || process.env.CHATRACE_API_BASE || "https://api.chatrace.com";
const SEND_TEXT_PATH = process.env.CHATRACE_SEND_TEXT_PATH || "/messages/send";
const SEND_TEMPLATE_PATH = process.env.CHATRACE_SEND_TEMPLATE_PATH || "/messages/send-template";

function authHeaders(): Record<string, string> {
  const headerStyle = process.env.CHATRACE_AUTH_HEADER;
  if (headerStyle === "X-Token") return { "X-Token": TOKEN, "Content-Type": "application/json" };
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}

async function callChatrace(path: string, payload: Record<string, unknown>): Promise<SendResult> {
  if (!TOKEN) return { ok: false, error: "CHATRACE_API_TOKEN or CHATRACE_API_KEY missing" };
  const url = `${BASE.replace(/\/$/, "")}${path}`;
  try {
    const res = await fetch(url, { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text}` };
    }
    const data = (await res.json().catch(() => ({}))) as any;
    return { ok: true, id: data?.id };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Network error" };
  }
}

/**
 * Send a plain WhatsApp text.
 * phone: E.164 e.g. "+2547XXXXXXX"
 * text: message body
 */
export async function sendWaText(phone: string, text: string): Promise<SendResult> {
  const payload = {
    to: phone,
    type: "text",
    text: { body: text },
  } as const;
  return callChatrace(SEND_TEXT_PATH, payload);
}

/**
 * Send a WhatsApp Template (approved notifications).
 * templateName: string exactly as approved in Chatrace
 * languageCode: e.g. "en" or "en_US"
 * components: template parameters per Chatrace schema
 */
export async function sendWaTemplate(
  phone: string,
  templateName: string,
  languageCode: string,
  components: Array<{ type: "body"; parameters: Array<{ type: "text"; text: string }> }>
): Promise<SendResult> {
  const payload = {
    to: phone,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  } as const;
  return callChatrace(SEND_TEMPLATE_PATH, payload);
}
