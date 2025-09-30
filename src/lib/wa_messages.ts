// src/lib/wa_messages.ts
// Builders for interactive messages (lists and reply buttons)

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
