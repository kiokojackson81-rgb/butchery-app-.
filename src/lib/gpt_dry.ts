// src/lib/gpt_dry.ts
// Deterministic, side-effect-free mapping from user text to a minimal
// reply + OOC for local development (WA_DRY_RUN or missing OPENAI key).

export type DryOOC = {
  intent: string;
  args?: Record<string, any>;
  buttons?: string[];
  next_state_hint?: string;
};

const ATT_TABS = [
  "ATT_TAB_STOCK",
  "ATT_TAB_SUPPLY",
  "ATT_TAB_DEPOSITS",
  "ATT_TAB_EXPENSES",
  "ATT_TAB_TILL",
  "ATT_TAB_SUMMARY",
] as const;

function parseAmount(str: string): number | null {
  const s = String(str || "").replace(/[,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function planDryResponse(userText: string): { text: string; ooc: DryOOC } {
  const t = String(userText || "").trim();
  const lower = t.toLowerCase();

  // 1-6 digit shortcuts
  const mDigit = /^\s*([1-6])\s*$/.exec(t);
  if (mDigit) {
    const map: Record<string, string> = {
      "1": "ATT_TAB_STOCK",
      "2": "ATT_TAB_SUPPLY",
      "3": "ATT_TAB_DEPOSITS",
      "4": "ATT_TAB_EXPENSES",
      "5": "ATT_TAB_TILL",
      "6": "ATT_TAB_SUMMARY",
    };
    const intent = map[mDigit[1]];
    return {
      text: intent === "ATT_TAB_STOCK" ? "📦 Stock — quick actions." : "Got it. Opening tab…",
      ooc: { intent, args: {}, buttons: [...ATT_TABS], next_state_hint: intent.replace("ATT_TAB_", "") },
    };
  }

  // Expense quick add: "Expense Fuel 300" (handles before generic expense tab)
  {
    const m = /^\s*expense\s+(\w[\w\- ]{1,24})\s+(\d[\d,]*)\s*$/i.exec(t);
    if (m) {
      const amt = parseAmount(m[2]);
      return {
        text: amt ? `Expense saved: ${m[1]} — KES ${amt}. 🧾` : `Expense: ${m[1]} — enter amount.`,
        ooc: { intent: "ATT_EXPENSE_ADD", args: { category: m[1], ...(amt ? { amount: amt } : {}) }, buttons: [...ATT_TABS], next_state_hint: "EXPENSES" },
      };
    }
  }

  // Explicit tab keywords
  if (/\bstock\b/i.test(t)) {
    return {
      text: "📦 Stock — quick actions.",
      ooc: { intent: "ATT_TAB_STOCK", args: {}, buttons: [...ATT_TABS], next_state_hint: "STOCK" },
    };
  }
  if (/\bsupply\b/i.test(t)) {
    return {
      text: "🚚 Supply — add today’s deliveries or view opening.",
      ooc: { intent: "ATT_TAB_SUPPLY", args: {}, buttons: [...ATT_TABS], next_state_hint: "SUPPLY" },
    };
  }
  if (/\bdeposit\b/i.test(t)) {
    return {
      text: "💰 Deposits — paste the full M‑PESA SMS.",
      ooc: { intent: "ATT_TAB_DEPOSITS", args: {}, buttons: [...ATT_TABS], next_state_hint: "DEPOSITS" },
    };
  }
  if (/\bexpense\b/i.test(t)) {
    return {
      text: "🧾 Expenses — e.g., Expense Fuel 300.",
      ooc: { intent: "ATT_TAB_EXPENSES", args: {}, buttons: [...ATT_TABS], next_state_hint: "EXPENSES" },
    };
  }
  if (/\btill\b/i.test(t)) {
    return {
      text: "🏦 Till — record a payment.",
      ooc: { intent: "ATT_TAB_TILL", args: {}, buttons: [...ATT_TABS], next_state_hint: "TILL" },
    };
  }
  if (/\bsummary\b/i.test(t)) {
    return {
      text: "🧮 Summary — today’s snapshot.",
      ooc: { intent: "ATT_TAB_SUMMARY", args: {}, buttons: [...ATT_TABS], next_state_hint: "SUMMARY" },
    };
  }

  // Lock day
  if (/\block\b/i.test(lower)) {
    return {
      text: "Lock day — confirm to proceed.",
      ooc: { intent: "LOCK_DAY", args: {}, buttons: [...ATT_TABS], next_state_hint: "LOCK_CONFIRM" },
    };
  }


  // Deposit MPESA parse (loose): detect amount and 10+ char ref
  {
    const ref = /\b([A-Z0-9]{10,})\b/.exec(t)?.[1];
    const amt = /(KES|Ksh|KSH)\s*([\d,]+\.?\d*)/i.exec(t)?.[2];
    const amount = amt ? parseAmount(amt) : null;
    if (ref || amount) {
      return {
        text: amount ? `MPESA ${ref || "REF"} for KES ${amount} detected. Recording deposit. 💰` : `MPESA detected. Recording deposit. 💰`,
        ooc: { intent: "ATT_DEPOSIT", args: { mpesaText: t, ...(ref ? { code: ref } : {}), ...(amount ? { amount } : {}) }, buttons: [...ATT_TABS], next_state_hint: "DEPOSITS" },
      };
    }
  }

  // Default free text
  return {
    text: "Let’s get you moving. Use the tabs below.",
    ooc: { intent: "FREE_TEXT", args: {}, buttons: [...ATT_TABS], next_state_hint: "MENU" },
  };
}
