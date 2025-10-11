import { prisma } from "@/lib/prisma";
import { runGptForIncoming } from "@/lib/gpt_router";
import { sendInteractiveSafe, sendTextSafe } from "@/lib/wa";
import { buildInteractiveListPayload } from "@/lib/wa_messages";
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

type BlueprintMenu = {
  text: string;
  rows: Array<{ id: string; title: string; description?: string }>;
};

async function resolveIdentity(phoneE164: string): Promise<{ name?: string | null; outlet?: string | null; role?: string | null }>
{
  try {
    const sess = await (prisma as any).waSession.findUnique({ where: { phoneE164 } });
    let name: string | null | undefined = undefined;
    if (sess?.code) {
      const pc = await (prisma as any).personCode.findUnique({ where: { code: sess.code } }).catch(() => null);
      if (pc?.name) name = pc.name;
    }
    return { name: name ?? undefined, outlet: sess?.outlet ?? undefined, role: sess?.role ?? undefined };
  } catch {
    return { name: undefined, outlet: undefined, role: undefined };
  }
}

function buildBlueprintMenu(role: string, opts: { outlet?: string; name?: string | null }): BlueprintMenu {
  const roleKey = String(role || "attendant").toLowerCase();
  const firstName = (opts.name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0];
  const displayName = firstName || opts.name || "there";
  const outletLabel = opts.outlet ? `${opts.outlet}` : "your outlet";

  if (roleKey === "supervisor") {
    return {
      text: `Welcome, ${displayName}.\nYou're logged in as a supervisor. What would you like to do?`,
      rows: [
        { id: "SV_REVIEW_CLOSINGS", title: "Review Closings", description: "Approve or reject closings" },
        { id: "SV_REVIEW_DEPOSITS", title: "Review Deposits", description: "Check pending deposits" },
        { id: "SV_REVIEW_EXPENSES", title: "Review Expenses", description: "Validate expense entries" },
        { id: "SV_REVIEW_SUPPLIES", title: "Review Supplies", description: "Review supply submissions" },
        { id: "SV_TXNS", title: "Transactions (TXNs)", description: "Browse transaction history" },
        { id: "LOGOUT", title: "Logout", description: "End session" },
      ],
    };
  }

  if (roleKey === "supplier") {
    return {
      text: `Welcome, ${displayName}.\nYou're logged in as a supplier. What would you like to do?`,
      rows: [
        { id: "SUPL_OPENING", title: "Opening Supply", description: "Set starting stock" },
        { id: "SUPL_DELIVERY", title: "Deliveries", description: "Record goods received" },
        { id: "SUPL_TRANSFER", title: "Transfers", description: "Move stock between outlets" },
        { id: "SUPL_DISPUTES", title: "Disputes", description: "Open or comment on issues" },
        { id: "SUPL_PRICEBOOK", title: "Pricebook", description: "Check product prices" },
        { id: "SUPL_CHANGE_CONTEXT", title: "Change Outlet/Date", description: "Switch outlet or date" },
        { id: "LOGOUT", title: "Logout", description: "End session" },
      ],
    };
  }

  const rows: BlueprintMenu["rows"] = [
    { id: "ATT_CLOSING", title: "Closing", description: "Enter closing stock" },
    { id: "ATT_DEPOSIT", title: "Deposit", description: "Record cash deposit" },
    { id: "MENU_SUMMARY", title: "Summary", description: "View today's totals" },
    { id: "ATT_EXPENSE", title: "Expense", description: "Log outlet expense" },
    { id: "MENU_SUPPLY", title: "Supply View", description: "Review deliveries" },
    { id: "ATT_WASTE", title: "Waste Entry", description: "Capture waste details" },
    { id: "CHANGE_CONTEXT", title: "Change Outlet/Date", description: "Switch outlet or date" },
    { id: "LOGOUT", title: "Logout", description: "End session" },
  ];

  return {
    text: `Welcome back, ${displayName}.\nYou're managing ${outletLabel}. What do you need today?`,
    rows,
  };
}

async function sendBlueprintGreetingFallback(phoneE164: string, role: string, outlet?: string | null) {
  const identity = await resolveIdentity(phoneE164);
  const mergedOutlet = outlet || identity.outlet || undefined;
  const menu = buildBlueprintMenu(role, { outlet: mergedOutlet || undefined, name: identity.name });
  const toGraph = toGraphPhone(phoneE164);

  await sendTextSafe(toGraph, menu.text, "AI_DISPATCH_TEXT", { gpt_sent: true });

  try {
    const payload = buildInteractiveListPayload({
      to: toGraph,
      bodyText: "Choose an action:",
      buttonLabel: "Menu",
      sections: [{ title: "Menu", rows: menu.rows }],
    });
    await sendInteractiveSafe(payload as any, "AI_DISPATCH_INTERACTIVE");
  } catch {
    // If interactive send fails, the text above still guides the user.
  }
}

function inDryMode(): boolean {
  if (String(process.env.WA_DRY_RUN || "").toLowerCase() === "true") return true;
  if (!process.env.OPENAI_API_KEY) return true;
  return String(process.env.NODE_ENV || "development").toLowerCase() !== "production";
}

/**
 * Send a GPT-composed greeting. If the AI returns a structured interactive payload,
 * attempt to send it (buttons or list). Otherwise fall back to plain text.
 */
export async function sendGptGreeting(phoneE164: string, role: string, outlet?: string) {
  if (inDryMode()) {
    await sendBlueprintGreetingFallback(phoneE164, role, outlet);
    return;
  }

  const toGraph = toGraphPhone(phoneE164);
  let sent = false;
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
          if (text) {
            await sendTextSafe(toGraph, text, "AI_DISPATCH_TEXT", { gpt_sent: true });
          }
        }
      }
      if (!sent && text) {
        await sendTextSafe(toGraph, text, "AI_DISPATCH_TEXT", { gpt_sent: true });
        sent = true;
      }
    }

    if (!sent && fallbackText) {
      await sendTextSafe(toGraph, fallbackText, "AI_DISPATCH_TEXT", { gpt_sent: true });
      sent = true;
    }
  } catch (e) {
    try { console.warn("sendGptGreeting fallback", e); } catch {}
  }

  if (!sent) {
    await sendBlueprintGreetingFallback(phoneE164, role, outlet);
  }
}

export default {};
