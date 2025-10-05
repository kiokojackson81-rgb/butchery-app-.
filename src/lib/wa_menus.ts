// lib/wa_menus.ts
import { sendInteractive } from "@/lib/wa";
import { getSupervisorConfig, getSupplierConfig } from "@/lib/wa_config";
import { menuMain } from "@/lib/wa_messages";

export async function sendAttendantMenu(to: string, outlet: string) {
  // Use the full list menu for a single, unified attendant menu
  const payload = await menuMain(to, outlet);
  await sendInteractive(payload);
}

export async function sendSupplierMenu(to: string) {
  const cfg = await getSupplierConfig();
  const rows: any[] = [
    { id: "SPL_DELIVER", title: "Submit Supply", description: "Enter opening items" },
  ];
  if (cfg.enableTransfer) rows.push({ id: "SPL_TRANSFER", title: "Record Transfer", description: "Move stock between outlets" });
  if (cfg.enableRecent) rows.push({ id: "SPL_RECENT", title: "Recent Supplies", description: "Today’s entries" });
  if (cfg.enableDisputes) rows.push({ id: "SPL_DISPUTES", title: "View Disputes", description: "Open disputes" });
  await sendInteractive({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "BarakaOps — Supplier" },
      body: { text: "Pick an action:" },
      action: {
        button: "Choose",
        sections: [
          {
            title: "Menu",
            rows,
          },
        ],
      },
    },
  });
}

export async function sendSupervisorMenu(to: string) {
  const cfg = await getSupervisorConfig();
  const buttons: any[] = [];
  if (cfg.showReview) buttons.push({ type: "reply", reply: { id: "SUP_REVIEW", title: "Review" } });
  if (cfg.showTxns) buttons.push({ type: "reply", reply: { id: "SUP_TXNS", title: "TXNS" } });
  if (cfg.showLogout) buttons.push({ type: "reply", reply: { id: "SUP_LOGOUT", title: "Logout" } });
  await sendInteractive({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Supervisor — choose a task" },
      action: {
        buttons,
      },
    },
  });
}
