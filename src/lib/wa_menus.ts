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
              { id: "ATT_TAB_STOCK", title: "Stock" },
              { id: "ATT_TAB_SUPPLY", title: "Supply" },
              { id: "ATT_TAB_DEPOSITS", title: "Deposits" },
              { id: "ATT_TAB_EXPENSES", title: "Expenses" },
              { id: "ATT_TAB_TILL", title: "Till" },
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
  // Canonical 6-tab menu (always shown)
  rows.push({ id: "ATT_TAB_STOCK", title: "Stock", description: "Enter closing & waste" });
  rows.push({ id: "MENU_SUPPLY", title: "Supply", description: "Opening math & add lines" });
  rows.push({ id: "ATT_DEPOSIT", title: "Deposits", description: "Paste M-PESA SMS" });
  rows.push({ id: "ATT_EXPENSE", title: "Expenses", description: "Quick categories" });
  rows.push({ id: "MENU_TXNS", title: "Till", description: "Payments / TXNS" });
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
    { id: "SUP_TAB_SUPPLY_TODAY", title: "Deliveries today", description: "Add or view lines" },
    { id: "SUP_TAB_VIEW", title: "View deliveries", description: "Recent activity" },
    { id: "SUP_TAB_DISPUTE", title: "Disputes", description: "Open items" },
    { id: "SUP_TAB_HELP", title: "Help / Logout", description: "Get help or exit" },
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
    { id: "SV_TAB_REVIEW_QUEUE", title: "Review queue" },
    { id: "SV_TAB_SUMMARIES", title: "Summaries" },
    { id: "SV_TAB_UNLOCK", title: "Unlock / Adjust" },
    { id: "SV_TAB_HELP", title: "Help / Logout" },
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
