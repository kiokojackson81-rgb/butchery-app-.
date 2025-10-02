// server/wa/wa_messages.ts
// Server-only builders for Supplier WhatsApp flows (interactive bodies)

export function buildSupplierMenu() {
  return {
    type: "button",
    body: { text: `BarakaOps — Supplier\nPick an action:` },
    action: {
      buttons: [
        { type: "reply", reply: { id: "SPL_DELIVER", title: "Submit Delivery" } },
        { type: "reply", reply: { id: "SPL_TRANSFER", title: "Record Transfer" } },
        { type: "reply", reply: { id: "SPL_RECENT", title: "Recent Deliveries" } },
      ],
    },
  } as const;
}

export function buildBackCancel() {
  return {
    type: "button",
    body: { text: "Choose:" },
    action: {
      buttons: [
        { type: "reply", reply: { id: "SPL_BACK", title: "Back" } },
        { type: "reply", reply: { id: "SPL_CANCEL", title: "Cancel" } },
      ],
    },
  } as const;
}

export function buildAfterSaveButtons(opts: { canLock: boolean }) {
  const buttons: any[] = [
    { type: "reply", reply: { id: "SPL_ADD_MORE", title: "Add another" } },
    { type: "reply", reply: { id: "SPL_MENU", title: "Finish" } },
  ];
  if (opts.canLock) buttons.splice(1, 0, { type: "reply", reply: { id: "SPL_LOCK", title: "Submit & Lock" } });
  return { type: "button", body: { text: "Next:" }, action: { buttons } } as const;
}

export function buildOutletList(outlets: { name: string }[]) {
  return {
    type: "list",
    body: { text: "Choose outlet" },
    action: {
      button: "Select",
      sections: [
        {
          title: "Outlets",
          rows: outlets.slice(0, 10).map((o) => ({ id: `SPL_O:${o.name}`, title: o.name })),
        },
      ],
    },
  } as const;
}

export function buildProductList(products: { key: string; name: string }[]) {
  return {
    type: "list",
    body: { text: "Choose product" },
    action: {
      button: "Select",
      sections: [
        {
          title: "Products",
          rows: products.slice(0, 10).map((p) => ({ id: `SPL_P:${p.key}`, title: p.name, description: "Add qty/price/unit" })),
        },
      ],
    },
  } as const;
}

// ========== Supervisor builders ==========

export function buildSupervisorMenu(outlet?: string) {
  const title = `BarakaOps — Supervisor${outlet ? " / " + outlet : ""}\nPick an action:`;
  return {
    type: "button",
    body: { text: title },
    action: {
      buttons: [
        { type: "reply", reply: { id: "SUP_REVIEW", title: "Review Queue" } },
        { type: "reply", reply: { id: "SUP_TXNS", title: "Deposits/Txns" } },
        { type: "reply", reply: { id: "SUP_REPORT", title: "Today Summary" } },
      ],
    },
  } as const;
}

export function buildReviewFilterButtons() {
  return {
    type: "button",
    body: { text: "Filter review items:" },
    action: {
      buttons: [
        { type: "reply", reply: { id: "SUP_FILTER_ALL", title: "All" } },
        { type: "reply", reply: { id: "SUP_FILTER_WASTE", title: "Waste" } },
        { type: "reply", reply: { id: "SUP_FILTER_EXPENSE", title: "Expense" } },
      ],
    },
  } as const;
}

export function buildReviewList(items: Array<{ id: string; title: string; desc?: string }>) {
  return {
    type: "list",
    body: { text: "Pick item to review" },
    action: {
      button: "Select",
      sections: [
        {
          title: "Pending",
          rows: items.slice(0, 10).map((i) => ({ id: `SUP_R:${i.id}`, title: i.title, description: i.desc || "" })),
        },
      ],
    },
  } as const;
}

export function buildApproveReject(id: string) {
  return {
    type: "button",
    body: { text: "Approve or Reject" },
    action: {
      buttons: [
        { type: "reply", reply: { id: `SUP_APPROVE:${id}`, title: "Approve" } },
        { type: "reply", reply: { id: `SUP_REJECT:${id}`, title: "Reject" } },
      ],
    },
  } as const;
}

export function buildDepositList(items: Array<{ id: string; line: string }>) {
  return {
    type: "list",
    body: { text: "Pick deposit" },
    action: {
      button: "Select",
      sections: [
        {
          title: "Deposits",
          rows: items.slice(0, 10).map((i) => ({ id: `SUP_D:${i.id}`, title: i.line.slice(0, 24), description: i.line.slice(24, 84) })),
        },
      ],
    },
  } as const;
}

export function buildDepositModerationButtons(id: string) {
  return {
    type: "button",
    body: { text: "Validate deposit:" },
    action: {
      buttons: [
        { type: "reply", reply: { id: `SUP_D_VALID:${id}`, title: "VALID" } },
        { type: "reply", reply: { id: `SUP_D_INVALID:${id}`, title: "INVALID" } },
      ],
    },
  } as const;
}

export function buildSummaryChoiceButtons() {
  return {
    type: "button",
    body: { text: "Today summary:" },
    action: {
      buttons: [
        { type: "reply", reply: { id: "SUP_SUMMARY_ALL", title: "All Outlets" } },
        { type: "reply", reply: { id: "SUP_SUMMARY_PICK_OUTLET", title: "Pick Outlet" } },
      ],
    },
  } as const;
}
