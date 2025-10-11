// src/lib/gpt_dry.ts
// Deterministic mapping from user text to a minimal reply + OOC for dry/run or missing GPT key.

export type DryOOC = {
  intent: string;
  args?: Record<string, any>;
  buttons?: string[];
  next_state_hint?: string;
};

const DEFAULT_ATTENDANT_BUTTONS = ["ATT_CLOSING", "ATT_DEPOSIT", "ATT_EXPENSE", "MENU_SUMMARY"] as const;

function parseAmount(str: string): number | null {
  const s = String(str || "").replace(/[,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildReply(
  text: string,
  intent: string,
  next: string,
  args: Record<string, any> = {},
  buttons: string[] = Array.from(DEFAULT_ATTENDANT_BUTTONS)
) {
  return {
    text,
    ooc: {
      intent,
      args,
      buttons,
      next_state_hint: next,
    },
  };
}

const BUTTON_HINTS: Record<string, { text: string; next: string }> = {
  ATT_CLOSING: { text: "Opening the closing flow.", next: "CLOSING_PICK" },
  ATT_DEPOSIT: { text: "Ready for the deposit SMS.", next: "WAIT_DEPOSIT" },
  ATT_EXPENSE: { text: "Let's capture that expense.", next: "EXPENSE_CAPTURE" },
  MENU_SUMMARY: { text: "Here's today's summary snapshot.", next: "SUMMARY" },
  MENU_SUPPLY: { text: "Viewing supply options.", next: "SUPPLY" },
  TILL_COUNT: { text: "Till count coming up.", next: "TILL_COUNT" },
  HELP: { text: "How can I help?", next: "MENU" },
  MENU: { text: "Back to the menu.", next: "MENU" },
  LOGOUT: { text: "Logging you out.", next: "LOGIN" },
};

const DIGIT_MAP: Record<string, string> = {
  "1": "ATT_CLOSING",
  "2": "ATT_DEPOSIT",
  "3": "ATT_EXPENSE",
  "4": "MENU_SUMMARY",
  "5": "TILL_COUNT",
  "6": "MENU_SUPPLY",
  "7": "HELP",
  "8": "MENU",
  "9": "LOGOUT",
};

export function planDryResponse(userText: string): { text: string; ooc: DryOOC } {
  const t = String(userText || "").trim();
  const lower = t.toLowerCase();

  // Interactive echoes e.g. "[button:ATT_CLOSING] Enter Closing"
  {
    const m = /^\s*\[button:([A-Z0-9_\-:]+)\]\s*(.*)$/i.exec(t);
    if (m) {
      const rawId = m[1].toUpperCase();
      const title = m[2].trim();
      const meta = BUTTON_HINTS[rawId] || { text: `Opening ${title || rawId}.`, next: "MENU" };
      return buildReply(meta.text, rawId, meta.next);
    }
  }

  // Digit shortcuts (1-9)
  const mDigit = /^\s*([1-9])\s*$/.exec(t);
  if (mDigit) {
    const intent = DIGIT_MAP[mDigit[1]];
    if (intent) {
      const meta = BUTTON_HINTS[intent] || { text: "Sure, taking you there.", next: "MENU" };
      return buildReply(meta.text, intent, meta.next);
    }
  }

  // Quick expense add (Expense Fuel 300)
  {
    const m = /^\s*expense\s+(\w[\w\- ]{1,32})\s+(\d[\d,\.]*)\s*$/i.exec(t);
    if (m) {
      const amt = parseAmount(m[2]);
      const item = m[1].trim();
      const args = { item, ...(amt ? { amountKES: amt, mode: "quick_add" as const } : { mode: "capture_amount" as const }) };
      const text = amt
        ? `Expense noted: ${item} — KES ${amt}. ✅`
        : `Expense "${item}" captured. Please send the amount.`;
      return buildReply(text, "ATT_EXPENSE", amt ? "EXPENSE_CONFIRM" : "EXPENSE_CAPTURE", args);
    }
  }

  // Keyword intents
  if (/\blogout\b/.test(lower)) {
    return buildReply("Logging you out.", "LOGOUT", "LOGIN");
  }
  if (/\bmenu\b/.test(lower)) {
    return buildReply("Back to the menu.", "MENU", "MENU");
  }
  if (/\bhelp\b/.test(lower)) {
    return buildReply("How can I help?", "HELP", "MENU");
  }
  if (/\bstock\b/i.test(t) || /\bclosing\b/i.test(lower)) {
    return buildReply("Let's record today's closing.", "ATT_CLOSING", "CLOSING_PICK");
  }
  if (/\bsupply\b/i.test(t)) {
    return buildReply("Opening supply view.", "MENU_SUPPLY", "SUPPLY");
  }
  if (/\bdeposit\b/i.test(t)) {
    return buildReply("Paste the full MPESA SMS.", "ATT_DEPOSIT", "WAIT_DEPOSIT");
  }
  if (/\bexpense\b/i.test(t)) {
    return buildReply("Let's capture that expense.", "ATT_EXPENSE", "EXPENSE_CAPTURE");
  }
  if (/\btill\b/i.test(t)) {
    return buildReply("Till count coming up.", "TILL_COUNT", "TILL_COUNT");
  }
  if (/\bsummary\b/i.test(t)) {
    return buildReply("Today's summary coming up.", "MENU_SUMMARY", "SUMMARY");
  }

  // Loose MPESA parse
  {
    const ref = /\b([A-Z0-9]{10,})\b/.exec(t)?.[1];
    const amt = /(KES|KSH|KSh|Ksh|ksh)\s*([\d,]+\.?\d*)/.exec(t)?.[2];
    const amount = amt ? parseAmount(amt) : null;
    if (ref || amount) {
      const args = {
        mpesaText: t,
        ...(ref ? { mpesaRef: ref } : {}),
        ...(amount ? { amountKES: amount } : {}),
      };
      const text = amount
        ? `Detected deposit ${ref || "REF"} for KES ${amount}.`
        : `Detected MPESA deposit details.`;
      return buildReply(text, "ATT_DEPOSIT", "WAIT_DEPOSIT", args);
    }
  }

  // Lock mention -> steer to summary for supervisor follow-up
  if (/\block\b/i.test(lower)) {
    return buildReply("Day lock needs supervisor confirmation.", "MENU_SUMMARY", "SUMMARY", { requested: "lock" });
  }

  // Default fallback
  return buildReply(
    "I didn't catch that. Let me know if you need closing, deposit, or expense help.",
    "FREE_TEXT",
    "MENU"
  );
}
