// src/lib/wa_messages.ts
// Centralized WhatsApp message payload builders (interactive + text)
// (import removed duplicate)

// WhatsApp payload limits (Interactive)
export const WA_MAXS = {
  ROW_TITLE: 24,
  ROW_DESC: 72,
  SECTION_TITLE: 24,
  BUTTON_LABEL: 20,
  BODY_TEXT: 1024, // safe cap
  HEADER_TEXT: 60, // practical cap; WA allows up to ~60-80 depending on type
  FOOTER_TEXT: 60,
  ROWS_PER_SECTION: 10, // WA hard limit
  TOTAL_ROWS: 30, // WA hard limit across sections
} as const;

function truncate(str: string | undefined, max: number): string | undefined {
  if (!str) return str;
  const s = String(str);
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1) + "…";
}

function sanitizeText(s: string | undefined, max: number): string | undefined {
  if (!s) return s;
  const clean = s
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
  return truncate(clean, max);
}

// Safe interactive list builder
export type InteractiveRow = { id: string; title: string; description?: string };
export type InteractiveSection = { title?: string; rows: InteractiveRow[] };

export function buildInteractiveListPayload(opts: {
  to: string; // Graph can accept with or without '+'; sender will normalize
  headerText?: string;
  bodyText: string;
  footerText?: string;
  buttonLabel?: string; // default: "Choose"
  sections: InteractiveSection[];
}) {
  // Enforce counts (WA limits)
  const flattenedRows = opts.sections.flatMap((s) => s.rows);
  if (flattenedRows.length === 0) {
    throw new Error("Interactive list requires at least 1 row.");
  }
  let normalizedSections = opts.sections;
  if (flattenedRows.length > WA_MAXS.TOTAL_ROWS) {
    let remaining = WA_MAXS.TOTAL_ROWS;
    const trimmedSections: InteractiveSection[] = [];
    for (const sec of opts.sections) {
      if (remaining <= 0) break;
      const take = Math.min(sec.rows.length, remaining, WA_MAXS.ROWS_PER_SECTION);
      trimmedSections.push({ ...sec, rows: sec.rows.slice(0, take) });
      remaining -= take;
    }
    normalizedSections = trimmedSections;
  } else {
    normalizedSections = opts.sections.map((sec) => ({ ...sec, rows: sec.rows.slice(0, WA_MAXS.ROWS_PER_SECTION) }));
  }

  const button = sanitizeText(opts.buttonLabel || "Tabs", WA_MAXS.BUTTON_LABEL)!;
  const header = sanitizeText(opts.headerText, WA_MAXS.HEADER_TEXT);
  const body = sanitizeText(opts.bodyText, WA_MAXS.BODY_TEXT)!;
  const footer = sanitizeText(opts.footerText, WA_MAXS.FOOTER_TEXT);

  const sections = normalizedSections.map((sec) => ({
    title: sanitizeText(sec.title, WA_MAXS.SECTION_TITLE),
    rows: sec.rows.map((r) => ({
      id: String(r.id),
      title: sanitizeText(r.title, WA_MAXS.ROW_TITLE)!,
      description: sanitizeText(r.description, WA_MAXS.ROW_DESC),
    })),
  }));

  return {
    messaging_product: "whatsapp",
    to: opts.to,
    type: "interactive",
    interactive: {
      type: "list",
      ...(header ? { header: { type: "text", text: header } } : {}),
      body: { text: body }, // NOTE: no "type" inside body
      ...(footer ? { footer: { text: footer } } : {}),
      action: {
        button,
        sections,
      },
    },
  } as const;
}

export function buildProductList(
  to: string,
  products: Array<{ id: string; title: string; desc?: string }>,
  opts?: { headerText?: string; bodyText?: string; footerText?: string; sectionTitle?: string }
) {
  const headerText = opts?.headerText ?? "Products";
  const bodyText = opts?.bodyText ?? "Pick a product to enter QTY/WASTE";
  const footerText = opts?.footerText;
  const sectionTitle = opts?.sectionTitle ?? "Items";
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: headerText },
      body: { text: bodyText },
      ...(footerText ? { footer: { text: footerText } } : {}),
      action: {
        button: "Tabs",
        sections: [
          {
            title: sectionTitle,
            rows: products.map((p) => ({ id: p.id, title: p.title, description: p.desc || "" })),
          },
        ],
      },
    },
  } as const;
}

export function buildNextSummarySubmit(to: string) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Actions" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "NEXT", title: "NEXT" } },
          { type: "reply", reply: { id: "SUMMARY", title: "SUMMARY" } },
          { type: "reply", reply: { id: "SUBMIT", title: "SUBMIT" } },
        ],
      },
    },
  } as const;
}

export function buildDepositCTA(to: string, expectedKsh: number) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: `Expected deposit: Ksh ${expectedKsh}. View TXNS or HELP?` },
      action: {
        buttons: [
          { type: "reply", reply: { id: "TXNS", title: "View TXNS" } },
          { type: "reply", reply: { id: "HELP", title: "HELP" } },
        ],
      },
    },
  } as const;
}

// ========== New API (builders requested in task) ==========

export function msgText(to: string, body: string) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  } as const;
}

import { getAttendantConfig } from "@/lib/wa_config";

export async function menuMain(to: string, outletName?: string) {
  const cfg = await getAttendantConfig();
  const rows: InteractiveRow[] = [
    { id: "ATT_CLOSING", title: "Submit today’s closing", description: cfg.enableWaste ? "Enter closing & waste" : "Enter closing only" },
  ];
  if (cfg.enableExpense) rows.push({ id: "ATT_EXPENSE", title: "Capture an expense", description: "Name and amount" });
  if (cfg.enableDeposit) rows.push({ id: "ATT_DEPOSIT", title: "Record Deposit", description: "Paste M-Pesa SMS" });
  if (cfg.enableTxns) rows.push({ id: "MENU_TXNS", title: "View till payments (10)", description: "Recent deposits" });
  if (cfg.enableSupplyView) rows.push({ id: "MENU_SUPPLY", title: "View today’s supply", description: "Opening stock by item" });
  if (cfg.enableSummary) rows.push({ id: "MENU_SUMMARY", title: "View summary", description: cfg.enableSubmitAndLock ? "Expected deposit & lock" : "Expected deposit" });

  return buildInteractiveListPayload({
    to,
    bodyText: outletName ? `${outletName} — what would you like to do?` : "What would you like to do?",
    footerText: "BarakaOps",
    buttonLabel: "Tabs",
    sections: [
      { title: "Menu", rows },
    ],
  });
}

export function listProducts(to: string, products: Array<{ key: string; name: string }>, outletName: string) {
  return buildInteractiveListPayload({
    to,
    headerText: undefined,
    bodyText: `${outletName} — choose product`,
    footerText: "BarakaOps",
    buttonLabel: "Tabs",
    sections: [
      {
        title: "Products",
        rows: products.map((p) => ({ id: `PROD_${p.key}`, title: p.name || p.key, description: "Enter closing & waste" })),
      },
    ],
  });
}

export function promptQty(to: string, itemTitle: string) {
  return msgText(to, `Enter closing stock (kg) for ${itemTitle}. Numbers only, e.g. 9.5`);
}

export function buttonsWasteOrSkip(to: string, itemTitle: string) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: sanitizeText(`Add waste for ${itemTitle}?`, WA_MAXS.BODY_TEXT)! },
      action: {
        buttons: [
          { type: "reply", reply: { id: "WASTE_YES", title: "Add Waste" } },
          { type: "reply", reply: { id: "WASTE_SKIP", title: "Skip" } },
        ],
      },
    },
  } as const;
}

export function promptWaste(to: string, itemTitle: string) {
  return msgText(to, `Enter waste (kg) for ${itemTitle}`);
}

export async function summarySubmitModify(
  to: string,
  rows: Array<{ name: string; closing: number; waste: number }>,
  outletName: string
) {
  const lines = rows.map((r) => `${r.name}: closing ${r.closing}, waste ${r.waste}`);
  const body = sanitizeText([outletName ? `${outletName} — summary` : "Summary", ...lines].join("\n"), WA_MAXS.BODY_TEXT)!;
  const cfg = await getAttendantConfig();
  const buttons: any[] = [
    { type: "reply", reply: { id: "SUMMARY_SUBMIT", title: "Submit" } },
  ];
  if (cfg.enableSubmitAndLock) {
    buttons.push({ type: "reply", reply: { id: "SUMMARY_LOCK", title: "Submit & Lock" } });
  }
  buttons.push({ type: "reply", reply: { id: "SUMMARY_MODIFY", title: "Modify" } });
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons,
      },
    },
  } as const;
}

export function expenseNamePrompt(to: string) {
  return msgText(to, "Enter expense name (e.g., Transport)");
}

export function expenseAmountPrompt(to: string, expenseName: string) {
  return msgText(to, `Enter amount for ${expenseName}. Numbers only, e.g. 250`);
}

export function expenseFollowupButtons(to: string) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Expense saved. Add another or finish?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "EXP_ADD_ANOTHER", title: "Add another" } },
          { type: "reply", reply: { id: "EXP_FINISH", title: "Finish" } },
        ],
      },
    },
  } as const;
}
