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

export async function sendSixTabs(to: string, role: "attendant"|"supervisor"|"supplier", outlet?: string) {
  const payload = buildSixTabsPayload(to, role, outlet);
  await sendInteractive(payload, "AI_DISPATCH_INTERACTIVE");
}
