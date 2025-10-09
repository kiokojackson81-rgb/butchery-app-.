// src/lib/wa_buttons.ts
import { buildInteractiveListPayload } from "@/lib/wa_messages";
import { sendInteractive } from "@/lib/wa";

export function sixTabsButtons() {
  return [
    { id: "ATT_TAB_STOCK", title: "Stock" },
    { id: "ATT_TAB_SUPPLY", title: "Supply" },
    { id: "ATT_TAB_DEPOSITS", title: "Deposits" },
    { id: "ATT_TAB_EXPENSES", title: "Expenses" },
    { id: "ATT_TAB_TILL", title: "Till" },
    { id: "ATT_TAB_SUMMARY", title: "Summary" },
  ];
}

export function roleDefaultButtons(role: "attendant"|"supervisor"|"supplier") {
  if (role === "supervisor") return [
    { id: "SV_REVIEW_CLOSINGS", title: "Review Closings" },
    { id: "SV_REVIEW_DEPOSITS", title: "Review Deposits" },
    { id: "SV_REVIEW_EXPENSES", title: "Review Expenses" },
    { id: "SV_APPROVE_UNLOCK", title: "Unlock / Approve" },
  ];
  if (role === "supplier") return [
    { id: "SUPL_DELIVERY", title: "Submit Delivery" },
    { id: "SUPL_VIEW_OPENING", title: "View Opening" },
    { id: "SUPL_DISPUTES", title: "Disputes" },
  ];
  return [
    { id: "ATT_CLOSING", title: "Enter Closing" },
    { id: "ATT_DEPOSIT", title: "Deposit" },
    { id: "ATT_EXPENSE", title: "Expense" },
    { id: "MENU_SUMMARY", title: "Summary" },
  ];
}

/** Build a unified six-tab list payload for any role */
export function buildSixTabsPayload(to: string, role: "attendant"|"supervisor"|"supplier", outlet?: string) {
  const date = new Date().toISOString().slice(0,10);
  if (role === "supervisor") {
    return buildInteractiveListPayload({
      to,
      bodyText: `Supervisor — ${date}. Use the tabs:`,
      footerText: "BarakaOps",
      buttonLabel: "Tabs",
      sections: [
        { title: "Supervisor Tabs", rows: [
          { id: "SV_TAB_REVIEW_QUEUE", title: "Review" },
          { id: "SV_TAB_SUMMARIES", title: "Summaries" },
          { id: "SV_TAB_UNLOCK", title: "Unlock" },
          { id: "SV_TAB_HELP", title: "Help" },
        ] },
      ],
    });
  }
  if (role === "supplier") {
    return buildInteractiveListPayload({
      to,
      bodyText: `Supplier — ${date}. Use the tabs:`,
      footerText: "BarakaOps",
      buttonLabel: "Tabs",
      sections: [
        { title: "Supplier Tabs", rows: [
          { id: "SUP_TAB_SUPPLY_TODAY", title: "Deliveries" },
          { id: "SUP_TAB_VIEW", title: "View" },
          { id: "SUP_TAB_DISPUTE", title: "Disputes" },
          { id: "SUP_TAB_HELP", title: "Help" },
        ] },
      ],
    });
  }
  // attendant default
  return buildInteractiveListPayload({
    to,
    bodyText: `${outlet || "Attendant"} — ${date}. Use the tabs:`,
    footerText: "BarakaOps",
    buttonLabel: "Tabs",
    sections: [
      { title: "Attendant Tabs", rows: sixTabsButtons() },
    ],
  });
}

export function buildRoleButtonsPayload(to: string, role: "attendant"|"supervisor"|"supplier", outlet?: string) {
  const rows = roleDefaultButtons(role);
  const buttons = rows.slice(0, 4).map((r) => ({ type: "reply", reply: { id: r.id, title: r.title } }));
  return { messaging_product: "whatsapp", to, type: "interactive", interactive: { type: "button", body: { text: `${role === 'attendant' ? (outlet ? `Welcome — ${outlet}` : 'Welcome') : (role==='supervisor' ? 'Supervisor' : 'Supplier') }` }, action: { buttons } } };
}

export async function sendSixTabs(to: string, role: "attendant"|"supervisor"|"supplier", outlet?: string) {
  // Replace list-based tabs with simple buttons. Interactive sending honors WA_INTERACTIVE_ENABLED.
  const payload = buildRoleButtonsPayload(to, role, outlet);
  await sendInteractive(payload, "AI_DISPATCH_INTERACTIVE");
}
