// src/lib/gpt_router.ts
import { prisma } from "@/lib/prisma";
import WA_MASTER_PROMPT from "@/ai/prompts/wa_master";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const GPT_TIMEOUT_MS = 15_000;

type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

async function getConversation(phoneE164: string): Promise<ChatTurn[]> {
  try {
    const row = await (prisma as any).appState.findUnique({ where: { key: `gpt:conv:${phoneE164}` } });
    const arr = Array.isArray((row as any)?.value) ? (row as any).value : [];
    return arr as ChatTurn[];
  } catch {
    return [];
  }
}

async function saveConversation(phoneE164: string, convo: ChatTurn[]) {
  try {
    await (prisma as any).appState.upsert({
      where: { key: `gpt:conv:${phoneE164}` },
      create: { key: `gpt:conv:${phoneE164}`, value: convo as any },
      update: { value: convo as any },
    });
  } catch {}
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("GPT_TIMEOUT")), ms);
    p.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}

export async function runGptForIncoming(phoneE164: string, userText: string): Promise<string> {
  const convo = await getConversation(phoneE164);
  const messages: ChatTurn[] = [
    { role: "system", content: WA_MASTER_PROMPT },
    ...convo,
    { role: "user", content: userText }
  ];

  try {
    async function callOnce() {
      const resp = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.2, max_tokens: 500, messages })
      });
      const json = await resp.json().catch(() => ({}));
      const status = resp.status;
      const text = String(json?.choices?.[0]?.message?.content || "").trim();
      return { status, text } as const;
    }

    // First attempt with timeout
    let { status, text } = await withTimeout(callOnce(), GPT_TIMEOUT_MS).catch((e) => {
      throw e;
    });
    // Retry once on transient errors
    if ((status >= 500 || status === 429) && !text) {
      ({ status, text } = await withTimeout(callOnce(), GPT_TIMEOUT_MS));
    }
    // Save short transcript (cap to last ~8 turns)
    const next: ChatTurn[] = [...convo, { role: "user", content: userText } as ChatTurn, { role: "assistant", content: text } as ChatTurn];
    const trimmed = next.slice(-8);
    await saveConversation(phoneE164, trimmed);
    return text || "";
  } catch (e: any) {
    // On timeout/failure return empty string to allow fallback menu at the webhook
    return "";
  }
}
