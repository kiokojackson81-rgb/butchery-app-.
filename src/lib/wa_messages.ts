// src/lib/wa_messages.ts
// Builders for interactive messages (lists and reply buttons)

export function buildProductList(to: string, products: Array<{ id: string; title: string; desc?: string }>) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Products" },
      body: { type: "text", text: "Select a product to enter QTY/WASTE" },
      action: {
        button: "Choose",
        sections: [
          {
            title: "Items",
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
      body: { type: "text", text: "Actions" },
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
      body: { type: "text", text: `Expected deposit: Ksh ${expectedKsh}. View TXNS or HELP?` },
      action: {
        buttons: [
          { type: "reply", reply: { id: "TXNS", title: "View TXNS" } },
          { type: "reply", reply: { id: "HELP", title: "HELP" } },
        ],
      },
    },
  } as const;
}
