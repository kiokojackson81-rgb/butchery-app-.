// lib/wa_menus.ts
import { sendInteractive } from "@/lib/wa";
import { getSupervisorConfig, getSupplierConfig } from "@/lib/wa_config";
import { buildInteractiveListPayload } from "@/lib/wa_messages";
import { getPeriodState } from "@/server/trading_period";
import { getAttendantConfig } from "@/lib/wa_config";

export async function sendAttendantMenu(to: string, outlet: string) {
  // State-aware: if LOCKED, show read-only items
  try {
    const date = new Date().toISOString().slice(0, 10);
    const state = await getPeriodState(outlet, date);
    if (state === "LOCKED") {
      await sendInteractive({
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: `Day is locked for ${outlet} (${date}).` },
          action: {
            buttons: [
              { type: "reply", reply: { id: "MENU_SUPPLY", title: "View opening" } },
              { type: "reply", reply: { id: "MENU_SUMMARY", title: "View summary" } },
              { type: "reply", reply: { id: "MENU", title: "Help / Logout" } },
            ],
          },
        },
      }, "AI_DISPATCH_INTERACTIVE");
      return;
    }
  } catch {}
  const cfg = await getAttendantConfig();
  const rows: any[] = [];
  // Order per spec
  rows.push({ id: "ATT_CLOSING", title: "Enter closing", description: "Open product list" });
  if (cfg.enableDeposit) rows.push({ id: "ATT_DEPOSIT", title: "Submit deposit", description: "Record till deposit" });
  if (cfg.enableExpense) rows.push({ id: "ATT_EXPENSE", title: "Add expense", description: "Name and amount" });
  if (cfg.enableTillCount) rows.push({ id: "ATT_TILL", title: "Till count", description: "Manual cash count" });
  if (cfg.enableSupplyView) rows.push({ id: "ATT_OPENING", title: "View opening", description: "Today’s opening stock" });
  if (cfg.enableSubmitAndLock) rows.push({ id: "ATT_LOCK", title: "Submit & lock", description: "Finalize today" });
  rows.push({ id: "ATT_HELP", title: "Help / Logout", description: "Get help or exit" });

  const payload = buildInteractiveListPayload({
    to,
    bodyText: `Welcome — you’re logged in as Attendant for ${outlet} (${new Date().toISOString().slice(0,10)}). Choose an option:`,
    footerText: "BarakaOps",
    buttonLabel: "Choose",
    sections: [{ title: "Menu", rows }],
  });
  await sendInteractive(payload, "AI_DISPATCH_INTERACTIVE");
}

export async function sendSupplierMenu(to: string) {
  const rows: any[] = [
    { id: "SUPL_DELIVERY", title: "Submit delivery", description: "Record today’s opening" },
    { id: "SUPL_VIEW_OPENING", title: "View today’s opening", description: "See entered items" },
    { id: "SUPL_DISPUTES", title: "Resolve disputes", description: "View/resolve items" },
    { id: "SUPL_HELP", title: "Help / Logout", description: "Get help or exit" },
  ];
  const payload = buildInteractiveListPayload({
    to,
    bodyText: `Welcome — you’re logged in as Supplier (${new Date().toISOString().slice(0,10)}).`,
    footerText: "BarakaOps",
    sections: [{ title: "Menu", rows }],
  });
  await sendInteractive(payload, "AI_DISPATCH_INTERACTIVE");
}

export async function sendSupervisorMenu(to: string) {
  const rows: any[] = [
    { id: "SV_REVIEW_CLOSINGS", title: "Review closings" },
    { id: "SV_REVIEW_DEPOSITS", title: "Review deposits" },
    { id: "SV_REVIEW_EXPENSES", title: "Review expenses" },
    { id: "SV_APPROVE_UNLOCK", title: "Approve / unlock day" },
    { id: "SV_HELP", title: "Help / Logout" },
  ];
  const payload = buildInteractiveListPayload({
    to,
    bodyText: `Welcome — Supervisor (${new Date().toISOString().slice(0,10)}).`,
    footerText: "BarakaOps",
    sections: [{ title: "Menu", rows }],
  });
  await sendInteractive(payload, "AI_DISPATCH_INTERACTIVE");
}
