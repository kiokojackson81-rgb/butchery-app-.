// lib/wa_menus.ts
import { sendInteractive } from "@/lib/wa";
import { getSupervisorConfig, getSupplierConfig } from "@/lib/wa_config";
import { buildInteractiveListPayload } from "@/lib/wa_messages";
import { getPeriodState } from "@/server/trading_period";
import { getAttendantConfig } from "@/lib/wa_config";

export async function sendAttendantMenu(to: string, outlet: string) {
  // Legacy sender hard-guard in GPT-only mode
  if (process.env.WA_GPT_ONLY === "true") return;
  // State-aware: if LOCKED, show read-only items
  try {
    const date = new Date().toISOString().slice(0, 10);
    const state = await getPeriodState(outlet, date);
    if (state === "LOCKED") {
      const payload = buildInteractiveListPayload({
        to,
        bodyText: `Day is locked for ${outlet} (${date}). Tabs available:`,
        footerText: "BarakaOps",
        buttonLabel: "Tabs",
        sections: [
          {
            title: "Attendant Tabs",
            rows: [
              { id: "ATT_TAB_STOCK", title: "Enter Closing" },
              { id: "ATT_TAB_SUPPLY", title: "Supply" },
              { id: "ATT_TAB_DEPOSITS", title: "Deposit" },
              { id: "ATT_TAB_EXPENSES", title: "Expense" },
              { id: "ATT_TAB_TILL", title: "Till Count" },
              { id: "ATT_TAB_SUMMARY", title: "Summary" },
            ],
          },
        ],
      });
      await sendInteractive(payload, "AI_DISPATCH_INTERACTIVE");
      return;
    }
  } catch {}
  const cfg = await getAttendantConfig();
  const rows: any[] = [];
  // Canonical 6-tab menu (always shown) — titles exactly match dashboard copy
  rows.push({ id: "ATT_TAB_STOCK", title: "Enter Closing", description: "Enter closing & waste" });
  rows.push({ id: "MENU_SUPPLY", title: "Supply", description: "Opening math & add lines" });
  rows.push({ id: "ATT_DEPOSIT", title: "Deposit", description: "Paste M-PESA SMS" });
  rows.push({ id: "ATT_EXPENSE", title: "Expense", description: "Quick categories" });
  rows.push({ id: "MENU_TXNS", title: "Till Count", description: "Payments / TXNS" });
  rows.push({ id: "MENU_SUMMARY", title: "Summary", description: cfg.enableSubmitAndLock ? "Lock day when ready" : "Totals" });

  const payload = buildInteractiveListPayload({
    to,
    bodyText: `You’re logged in as Attendant for ${outlet} (${new Date().toISOString().slice(0,10)}). Use the tabs:`,
    footerText: "BarakaOps",
    buttonLabel: "Tabs",
    sections: [{ title: "Menu", rows }],
  });
  await sendInteractive(payload, "AI_DISPATCH_INTERACTIVE");
}

export async function sendSupplierMenu(to: string) {
  // Legacy sender hard-guard in GPT-only mode
  if (process.env.WA_GPT_ONLY === "true") return;
  const rows: any[] = [
    { id: "SUPL_DELIVERY", title: "Submit Delivery", description: "Add or view lines" },
    { id: "SUPL_VIEW_OPENING", title: "View Opening", description: "Recent activity" },
    { id: "SUPL_DISPUTES", title: "Disputes", description: "Open items" },
    { id: "SUPL_HELP", title: "Help / Logout", description: "Get help or exit" },
  ];
  const payload = buildInteractiveListPayload({
    to,
    bodyText: `You’re logged in as Supplier (${new Date().toISOString().slice(0,10)}).`,
    footerText: "BarakaOps",
    buttonLabel: "Tabs",
    sections: [{ title: "Menu", rows }],
  });
  await sendInteractive(payload, "AI_DISPATCH_INTERACTIVE");
}

export async function sendSupervisorMenu(to: string) {
  // Legacy sender hard-guard in GPT-only mode
  if (process.env.WA_GPT_ONLY === "true") return;
  const rows: any[] = [
    { id: "SV_REVIEW_CLOSINGS", title: "Review Closings" },
    { id: "SV_REVIEW_DEPOSITS", title: "Review Deposits" },
    { id: "SV_REVIEW_EXPENSES", title: "Review Expenses" },
    { id: "SV_HELP", title: "Help / Logout" },
  ];
  const payload = buildInteractiveListPayload({
    to,
    bodyText: `You’re logged in as Supervisor (${new Date().toISOString().slice(0,10)}).`,
    footerText: "BarakaOps",
    buttonLabel: "Tabs",
    sections: [{ title: "Menu", rows }],
  });
  await sendInteractive(payload, "AI_DISPATCH_INTERACTIVE");
}

export type { };
