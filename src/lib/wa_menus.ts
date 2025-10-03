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
          { type: "reply", reply: { id: "ATD_EXPENSE", title: "Expense" } },
          { type: "reply", reply: { id: "ATD_TXNS", title: "TXNS" } },
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
      type: "button",
      body: { text: "BarakaOps — Supplier\nPick an action:" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "SPL_DELIVER", title: "Submit Delivery" } },
          { type: "reply", reply: { id: "SPL_TRANSFER", title: "Record Transfer" } },
          { type: "reply", reply: { id: "SPL_RECENT", title: "Recent Deliveries" } },
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
