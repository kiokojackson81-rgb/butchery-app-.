// src/lib/ai_util.ts
import { WA_SYSTEM_PROMPT } from "@/ai/prompts/wa_system";

export type OpsContext =
  | { kind: "login_welcome"; role: "attendant"|"supplier"|"supervisor"; outlet?: string; name?: string }
  | { kind: "closing_reminder"; outlet: string; pendingAmount?: number }
  | { kind: "supply_notice"; outlet: string; list?: string }
  | { kind: "assignment_notice"; role: string; outlet: string }
  | { kind: "login_prompt"; reason?: string }
  | { kind: "free_text"; text: string };

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

type GraphButtonPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "interactive";
  interactive: any; // keep loose; constructed buttons/lists
};

// GPT/OOC removed: provide no-op fallbacks to keep callers working during purge
export function buildAuthenticatedReplyLegacy(role: string, outlet?: string | null) {
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  const outletText = outlet ? ` — ${outlet}` : "";
  return { text: `Login successful for ${roleLabel}${outletText}. Reply MENU for options.` };
}
export function buildUnauthenticatedReplyLegacy(deepLink: string) {
  return { text: `You're not logged in. Tap to sign in: ${deepLink}` };
}

export async function composeWaMessage(ctx: OpsContext, opts?: { deepLink?: string }): Promise<{ text?: string; interactive?: GraphButtonPayload; ooc?: string; buttons?: string[] }> {
  // Fast-path some contexts without model calls when obvious
  if (ctx.kind === "free_text") {
    return { text: ctx.text };
  }

  const deepLink = opts?.deepLink || null;
  // Deterministic login welcome: build exact menu + OOC without calling model
  if (ctx.kind === "login_welcome") {
  const c = buildAuthenticatedReplyLegacy(ctx.role, ctx.outlet);
  return { text: c.text };
  }

  // Deterministic login prompt: compose strict login nudge with OOC
  if (ctx.kind === "login_prompt") {
  const deep = opts?.deepLink || (process.env.APP_ORIGIN || "https://barakafresh.com") + "/login";
  const reply = buildUnauthenticatedReplyLegacy(deep);
  return { text: reply.text };
  }

  const userPrompt = buildUserPrompt(ctx, deepLink || undefined);

  // If AI is disabled, return a deterministic minimal message
  if (String(process.env.WA_AI_ENABLED || "true").toLowerCase() !== "true") {
    return { text: userPrompt.slice(0, 750) };
  }

  const sys = WA_SYSTEM_PROMPT;
  try {
    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt }
        ]
      })
    });
    const json = await resp.json().catch(() => ({}));
    const text = (json?.choices?.[0]?.message?.content || "").toString().trim();
    return { text: (text || userPrompt).slice(0, 790) };
  } catch (e) {
    return { text: userPrompt.slice(0, 750) };
  }
}

function buildUserPrompt(ctx: OpsContext, deepLink?: string): string {
  switch (ctx.kind) {
    case "login_prompt": {
      const reason = ctx.reason ? `Reason: ${ctx.reason}. ` : "";
      const linkLine = deepLink ? `Tap to log in: ${deepLink}` : "Open the BarakaOps login page and complete sign-in.";
      return `${reason}Please log in to continue. ${linkLine}`.trim();
    }
    case "login_welcome": {
      const who = ctx.role === "attendant" ? "Attendant" : ctx.role === "supervisor" ? "Supervisor" : "Supplier";
      const outlet = ctx.outlet ? ` — ${ctx.outlet}` : "";
      return `Login successful for ${who}${outlet}. Provide a short welcome plus a numbered options menu for this role. If deep link is present, include a one-line instruction to tap it.\n${deepLink ? `Open link: ${deepLink}` : ""}`.trim();
    }
    case "closing_reminder": {
      const amt = Number(ctx.pendingAmount || 0);
      const line = amt > 0 ? `Pending deposit today: KES ${amt.toLocaleString("en-KE")}.` : "";
      return `Closing reminder for ${ctx.outlet}. ${line} Provide a short nudge and show a compact options menu.`;
    }
    case "supply_notice": {
      const list = ctx.list ? `\n${ctx.list}` : "";
      return `Supply recorded for ${ctx.outlet}.${list}\nProvide an acknowledgement and offer next actions (e.g., Dispute, View deliveries, Help).`;
    }
    case "assignment_notice": {
      return `Assignment updated: role=${ctx.role}, outlet=${ctx.outlet}. Provide a short confirmation and next-step menu.`;
    }
    case "free_text":
      return ctx.text;
  }
}

export type { GraphButtonPayload };
