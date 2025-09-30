// src/lib/wa_messages.ts
// Centralized WhatsApp message payload builders (interactive + text)

export function buildProductList(
  to: string,
  products: Array<{ id: string; title: string; desc?: string }>,
  opts?: { headerText?: string; bodyText?: string; footerText?: string; sectionTitle?: string }
) {
  const headerText = opts?.headerText ?? "Products";
  const bodyText = opts?.bodyText ?? "Select a product to enter QTY/WASTE";
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
        button: "Choose product",
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

export function menuMain(to: string, outletName?: string) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: outletName ? `${outletName} — what would you like to do?` : "What would you like to do?" },
      footer: { text: "BarakaOps" },
      action: {
        button: "Choose",
        sections: [
          {
            title: "Menu",
            rows: [
              { id: "MENU_SUBMIT_CLOSING", title: "Submit today’s closing", description: "Enter closing & waste" },
              { id: "MENU_EXPENSE", title: "Capture an expense", description: "Name and amount" },
              { id: "MENU_TXNS", title: "View last 10 transactions", description: "Recent deposits" },
            ],
          },
        ],
      },
    },
  } as const;
}

export function listProducts(
  to: string,
  products: Array<{ key: string; name: string }>,
  outletName: string
) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: `${outletName} — choose product` },
      footer: { text: "BarakaOps" },
      action: {
        button: "Choose",
        sections: [
          {
            title: "Products",
            rows: products.map((p) => ({ id: `PROD_${p.key}`, title: p.name, description: "Enter closing & waste" })),
          },
        ],
      },
    },
  } as const;
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
      body: { text: `Add waste for ${itemTitle}?` },
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

export function summarySubmitModify(
  to: string,
  rows: Array<{ name: string; closing: number; waste: number }>,
  outletName: string
) {
  const lines = rows.map((r) => `${r.name}: closing ${r.closing}, waste ${r.waste}`);
  const body = [outletName ? `${outletName} — summary` : "Summary", ...lines].join("\n").slice(0, 1024);
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: [
          { type: "reply", reply: { id: "SUMMARY_SUBMIT", title: "Submit" } },
          { type: "reply", reply: { id: "SUMMARY_MODIFY", title: "Modify" } },
        ],
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
