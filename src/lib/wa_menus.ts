// lib/wa_menus.ts
import { sendInteractive } from "@/lib/wa";
import { buildInteractiveListPayload } from "@/lib/wa_messages";

export async function sendAttendantMenu(to: string, outlet: string) {
  const payload = buildInteractiveListPayload({
    to,
    bodyText: `Welcome — managing ${outlet}. Choose an action:`,
    footerText: "BarakaOps",
    buttonLabel: "Choose",
    sections: [
      {
        title: "Actions",
        rows: [
          { id: "ATTENDANT_CLOSING", title: "Submit Closing", description: "Enter closing & waste" },
          { id: "ATTENDANT_EXPENSE", title: "Record Expense", description: "Add an expense" },
          { id: "ATTENDANT_DEPOSIT", title: "Record Deposit", description: "Bank/Till deposit" },
          { id: "ATTENDANT_SUMMARY", title: "Today Summary", description: "Sales & totals" },
        ],
      },
    ],
  });
  await sendInteractive(payload);
}

export async function sendSupplierMenu(to: string) {
  const payload = buildInteractiveListPayload({
    to,
    bodyText: "Supplier — what would you like to do?",
    footerText: "BarakaOps",
    buttonLabel: "Choose",
    sections: [
      {
        title: "Actions",
        rows: [
          { id: "SUPPLY_OPENING", title: "Opening Supply", description: "Add opening stock" },
          { id: "SUPPLY_TRANSFER", title: "Transfer", description: "Transfer between outlets" },
          { id: "SUPPLY_REPORT", title: "PDF / Report", description: "Get a report" },
          { id: "SUPPLY_DISPUTE", title: "Dispute", description: "Raise a dispute" },
        ],
      },
    ],
  });
  await sendInteractive(payload);
}

export async function sendSupervisorMenu(to: string) {
  const payload = buildInteractiveListPayload({
    to,
    bodyText: "Supervisor — choose a task:",
    footerText: "BarakaOps",
    buttonLabel: "Choose",
    sections: [
      {
        title: "Actions",
        rows: [
          { id: "SUPERVISOR_REVIEW", title: "Review Queue", description: "Approve/reject items" },
          { id: "SUPERVISOR_SUMMARY", title: "Outlet Summary", description: "Daily overview" },
        ],
      },
    ],
  });
  await sendInteractive(payload);
}
