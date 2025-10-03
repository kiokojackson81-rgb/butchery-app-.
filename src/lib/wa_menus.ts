// lib/wa_menus.ts
import { sendInteractive } from "@/lib/wa";

export async function sendAttendantMenu(to: string, outlet: string) {
  // Compact 3-button menu (WhatsApp allows max 3 buttons)
  await sendInteractive({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: `Managing ${outlet}. What would you like to do?` },
      action: {
        buttons: [
          { type: "reply", reply: { id: "ATD_CLOSING", title: "Closing" } },
          { type: "reply", reply: { id: "ATD_DEPOSIT", title: "Record Deposit" } },
          { type: "reply", reply: { id: "MENU", title: "Menu" } },
        ],
      },
    },
  });
}

export async function sendSupplierMenu(to: string) {
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
            rows: [
              { id: "SPL_DELIVER", title: "Submit Supply", description: "Enter opening items" },
              { id: "SPL_TRANSFER", title: "Record Transfer", description: "Move stock between outlets" },
              { id: "SPL_RECENT", title: "Recent Supplies", description: "Today’s entries" },
              { id: "SPL_DISPUTES", title: "View Disputes", description: "Open disputes" },
            ],
          },
        ],
      },
    },
  });
}

export async function sendSupervisorMenu(to: string) {
  await sendInteractive({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Supervisor — choose a task" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "SUP_REVIEW", title: "Review" } },
          { type: "reply", reply: { id: "SUP_TXNS", title: "TXNS" } },
          { type: "reply", reply: { id: "SUP_LOGOUT", title: "Logout" } },
        ],
      },
    },
  });
}
