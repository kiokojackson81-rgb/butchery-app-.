import { runGptForIncoming } from "@/lib/gpt_router";
import { sendTextSafe } from "@/lib/wa";
import { toGraphPhone } from "@/server/canon";
import { trySendGptInteractive } from "./wa_gpt_interact";

export type GptGreetingResult = {
  ok: boolean;
  via?: "interactive" | "text";
  fallback?: boolean;
  errors?: string[];
};

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

function buildFallbackGreeting(role: string, outlet?: string): string {
  const roleKey = String(role || "attendant").toLowerCase();
  const atOutlet = outlet ? ` at ${outlet}` : "";
  switch (roleKey) {
    case "supervisor":
      return `You're logged in as a supervisor${atOutlet}. Reply with:\n1) Review Closings\n2) Review Deposits\n3) Unlock/Adjust\n4) Help`;
    case "supplier":
      return `You're logged in as a supplier${atOutlet}. Reply with:\n1) Submit Delivery\n2) View Opening\n3) Disputes\n4) Help`;
    default:
      return `You're logged in as an attendant${atOutlet}. Reply with:\n1) Enter Closing\n2) Deposit (paste SMS)\n3) Expense\n4) Summary`;
  }
}

/**
 * Send a GPT-composed greeting. If the AI returns a structured interactive payload,
 * attempt to send it (buttons or list). Otherwise fall back to plain text.
 */
export async function sendGptGreeting(phoneE164: string, role: string, outlet?: string): Promise<GptGreetingResult> {
  const toGraph = toGraphPhone(phoneE164);
  let sent = false;
  let via: "interactive" | "text" | undefined;
  let usedDefaultFallback = false;
  const errors: string[] = [];
  try {
    const prompt = `Prefer returning JSON object with optional fields: { text?: string, interactive?: { type: 'buttons'|'list', buttons?: [{id,title}], sections?: [{title, rows:[{id,title,description}]}], buttonLabel?: string, bodyText?: string, footerText?: string } }.
Return a short (1-2 sentence) greeting for a user logged in as ${role}${outlet ? ` at ${outlet}` : ''}. If user can act via quick replies, include an interactive payload. Ensure buttons are short and <=3; if more actions are needed, use a 'list' structure. Only emit raw JSON (no explanatory text) when possible.`;
    const reply = await runGptForIncoming(phoneE164, prompt);
    const { structured, fallbackText } = coerceStructuredReply(reply);

    if (structured && typeof structured === "object") {
      const inter = (structured as any).interactive as any | undefined;
      const text = String((structured as any).text || "").trim();
      if (inter) {
        const sentInteractive = await trySendGptInteractive(toGraph.replace(/^\+/, ""), inter);
        if (sentInteractive) {
          sent = true;
          via = via || "interactive";
          if (text) {
            const res = await sendTextSafe(toGraph, text, "AI_DISPATCH_TEXT", { gpt_sent: true });
            if (!res?.ok) {
              errors.push((res as any)?.error || "text-send-failed");
            } else if (!via) {
              via = "text";
            }
          }
        } else {
          errors.push("interactive-send-failed");
        }
      }
      if (!sent && text) {
        const res = await sendTextSafe(toGraph, text, "AI_DISPATCH_TEXT", { gpt_sent: true });
        if ((res as any)?.ok) {
          sent = true;
          if (!via) via = "text";
        } else {
          errors.push((res as any)?.error || "text-send-failed");
        }
      }
    }

    if (!sent && fallbackText) {
      const res = await sendTextSafe(toGraph, fallbackText, "AI_DISPATCH_TEXT", { gpt_sent: true });
      if ((res as any)?.ok) {
        sent = true;
        if (!via) via = "text";
      } else {
        errors.push((res as any)?.error || "text-send-failed");
      }
    }
  } catch (e) {
    try { console.warn("sendGptGreeting fallback", e); } catch {}
    errors.push(e instanceof Error ? e.message : String(e));
  }

  if (!sent) {
    const fallback = buildFallbackGreeting(role, outlet);
    usedDefaultFallback = true;
    const res = await sendTextSafe(toGraph, fallback, "AI_DISPATCH_TEXT", { gpt_sent: true });
    if ((res as any)?.ok) {
      sent = true;
      if (!via) via = "text";
    } else {
      errors.push((res as any)?.error || "text-send-failed");
    }
  }
  if (!sent) {
    try { console.warn("sendGptGreeting failed", { phoneE164, role, outlet, errors }); } catch {}
  }
  return { ok: sent, via, fallback: usedDefaultFallback, errors };
}

export default {};
