import { runGptForIncoming } from "@/lib/gpt_router";
import { sendTextSafe } from "@/lib/wa";
import { toGraphPhone } from "@/server/canon";
import { trySendGptInteractive } from "./wa_gpt_interact";

function stripOoc(raw: string): string {
  if (!raw) return raw;
  return raw.replace(/<<<OOC>[\s\S]*?<\/OOC>>>/g, "").trim();
}

function coerceStructuredReply(raw: unknown): { structured?: any; fallbackText?: string } {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return { structured: raw, fallbackText: String((raw as any).text || "").trim() };
  }
  if (typeof raw !== "string") return {};

  const cleaned = stripOoc(String(raw).trim());
  if (!cleaned) return {};

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      const prefix = cleaned.slice(0, firstBrace).trim();
      const suffix = cleaned.slice(lastBrace + 1).trim();
      const fallbackText = String(parsed?.text || "").trim() || [prefix, suffix].filter(Boolean).join("\n").trim();
      return { structured: parsed, fallbackText };
    } catch {
      // fall through to plain text fallback
    }
  }

  return { fallbackText: cleaned };
}

/**
 * Send a GPT-composed greeting. If the AI returns a structured interactive payload,
 * attempt to send it (buttons or list). Otherwise fall back to plain text.
 */
export async function sendGptGreeting(phoneE164: string, role: string, outlet?: string) {
  try {
    const prompt = `Prefer returning JSON object with optional fields: { text?: string, interactive?: { type: 'buttons'|'list', buttons?: [{id,title}], sections?: [{title, rows:[{id,title,description}]}], buttonLabel?: string, bodyText?: string, footerText?: string } }.
Return a short (1-2 sentence) greeting for a user logged in as ${role}${outlet ? ` at ${outlet}` : ''}. If user can act via quick replies, include an interactive payload. Ensure buttons are short and <=3; if more actions are needed, use a 'list' structure. Only emit raw JSON (no explanatory text) when possible.`;
    const reply = await runGptForIncoming(phoneE164, prompt);
    const { structured, fallbackText } = coerceStructuredReply(reply);
    const to = toGraphPhone(phoneE164);

    if (structured && typeof structured === "object") {
      const inter = (structured as any).interactive as any | undefined;
      const text = String((structured as any).text || "").trim();
      if (inter) {
        const sent = await trySendGptInteractive(to.replace(/^\+/, ""), inter);
        if (sent) {
          if (text) await sendTextSafe(to, text, "AI_DISPATCH_TEXT", { gpt_sent: true });
          return;
        }
      }
      if (text) {
        await sendTextSafe(to, text, "AI_DISPATCH_TEXT", { gpt_sent: true });
        return;
      }
    }

    if (fallbackText) {
      await sendTextSafe(to, fallbackText, "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
  } catch (e) { /* best-effort */ }
}

export default {};
