// src/lib/chatrace.ts
export type WAParams = {
  to: string;
  text: string;
  templateName?: string;
  templateParams?: string[];
};

// Support both our original names and the playbook's alternative names
const API_BASE = (process.env.CHATRACE_API_BASE || process.env.CHATRACE_BASE) as string | undefined;
const API_KEY = (process.env.CHATRACE_API_KEY || process.env.CHATRACE_API_TOKEN) as string | undefined;
const FROM = (process.env.CHATRACE_FROM_PHONE || process.env.CHATRACE_SENDER_ID || "") as string;

function authHeaders() {
  if (!API_BASE || !API_KEY) throw new Error("Chatrace env vars missing");
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  } as Record<string, string>;
}

export async function chatraceSendText({ to, text }: { to: string; text: string }) {
  const base = API_BASE;
  if (!base) throw new Error("Chatrace env vars missing");
  const url = `${base}/v1/messages/send`;
  const body = {
    to,
    channel: "whatsapp",
    type: "text",
    text,
    from: FROM || undefined,
  };
  const r = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const msg = await r.text();
    throw new Error(`Chatrace send error ${r.status}: ${msg}`);
  }
  return r.json();
}

export async function chatraceSendTemplate(to: string, templateName: string, params: string[] = []) {
  const base = API_BASE;
  if (!base) throw new Error("Chatrace env vars missing");
  const url = `${base}/v1/messages/send`;
  const body = {
    to,
    channel: "whatsapp",
    type: "template",
    template: {
      name: templateName,
      language: "en",
      components: [
        { type: "body", parameters: params.map((p) => ({ type: "text", text: p })) },
      ],
    },
    from: FROM || undefined,
  } as any;
  const r = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
