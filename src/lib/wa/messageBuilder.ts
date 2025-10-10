export type WaQuickReplyButton = { type: "reply"; reply: { id: string; title: string } };
export type WaButtonPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "interactive";
  interactive: {
    type: "button";
    body: { text: string };
    footer?: { text: string };
    action: { buttons: WaQuickReplyButton[] };
  };
};

export type WaListPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "interactive";
  interactive: {
    type: "list";
    header?: { type: "text"; text: string };
    body: { text: string };
    footer?: { text: string };
    action: {
      button: string;
      sections: Array<{
        title?: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    };
  };
};

export interface ProductOption {
  id: string;
  title: string;
  description?: string;
}

const NAV_BUTTONS: WaQuickReplyButton[] = [
  { type: "reply", reply: { id: "NAV_BACK", title: "⬅ Back" } },
  { type: "reply", reply: { id: "NAV_CANCEL", title: "❌ Cancel" } },
  { type: "reply", reply: { id: "NAV_MENU", title: "🏠 Menu" } },
];

export function buildNavigationRow(): WaQuickReplyButton[] {
  return [...NAV_BUTTONS];
}

export function buildAttendantMainMenuText(outletName?: string, tradingDate?: string): string {
  const header = [
    outletName ? `Outlet: ${outletName}` : null,
    tradingDate ? `Date: ${tradingDate}` : null,
  ]
    .filter(Boolean)
    .join(" • ");
  const intro = header ? `${header}\n` : "";
  return `${intro}How can I assist you today?`;
}

export function buildAttendantMainMenuButtons(): WaQuickReplyButton[] {
  return [
    { type: "reply", reply: { id: "ATT_CLOSING", title: "Enter Closing" } },
    { type: "reply", reply: { id: "ATT_DEPOSIT", title: "Deposit" } },
    { type: "reply", reply: { id: "ATT_EXPENSE", title: "Expense" } },
    { type: "reply", reply: { id: "ATT_SUMMARY", title: "Summary" } },
    { type: "reply", reply: { id: "ATT_TILL", title: "Till Count" } },
    { type: "reply", reply: { id: "ATT_SUPPLY", title: "Supply" } },
  ];
}

export function buildProductPickerBody(products: ProductOption[], pageLabel?: string): WaListPayload["interactive"] {
  return {
    type: "list",
    header: { type: "text", text: "Select a product" },
    body: { text: "Tap a product to record closing stock." },
    footer: pageLabel ? { text: pageLabel } : undefined,
    action: {
      button: "Products",
      sections: [
        {
          title: "Products",
          rows: products.map((p) => ({ id: p.id, title: p.title, description: p.description })),
        },
      ],
    },
  };
}

export function buildQuantityPromptText(productName: string, example = "e.g., 12 or 12.5"): string {
  return `Enter closing stock for ${productName}. ${example}`;
}

export function buildReviewSummaryText(outletName: string, draftLines: string[]): string {
  const header = `Closing Summary — ${outletName}`;
  return `${header}\n\n${draftLines.join("\n")}`;
}

export function attachNavigationButtons(payload: WaButtonPayload["interactive"], includeMenu = true): WaButtonPayload["interactive"] {
  const baseButtons = includeMenu ? NAV_BUTTONS : NAV_BUTTONS.slice(0, 2);
  return {
    ...payload,
    action: {
      buttons: [...payload.action.buttons, ...baseButtons],
    },
  };
}
export function buildButtonPayload(to: string, text: string, buttons: WaQuickReplyButton[], footer?: string): WaButtonPayload {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text },
      ...(footer ? { footer: { text: footer } } : {}),
      action: { buttons },
    },
  };
}

export function buildListPayload(to: string, interactive: WaListPayload["interactive"]): WaListPayload {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive,
  };
}
