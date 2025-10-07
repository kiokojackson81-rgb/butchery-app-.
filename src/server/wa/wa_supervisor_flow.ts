// server/wa/wa_supervisor_flow.ts
// Clean single-definition supervisor WhatsApp flow (review, deposits, summary)
import { prisma } from "@/lib/prisma";
import { sendText, sendInteractive } from "@/lib/wa";
import { toGraphPhone } from "@/lib/wa_phone";
import {
  buildSupervisorMenu,
  buildReviewFilterButtons,
  buildReviewList,
  buildApproveReject,
  buildDepositList,
  buildDepositModerationButtons,
  buildSummaryChoiceButtons,
} from "@/server/wa/wa_messages";
import { notifyAttendants, notifySupplier } from "@/server/supervisor/supervisor.notifications";

export type SupervisorState =
  | "SUP_MENU"
  | "SUP_REVIEW_PICK_FILTER"
  | "SUP_REVIEW_LIST"
  | "SUP_REVIEW_ITEM"
  | "SUP_DEPOSIT_LIST"
  | "SUP_DEPOSIT_ITEM"
  | "SUP_SUMMARY"
  | "SUP_LOCK_CONFIRM"
  | "SUP_UNLOCK_CONFIRM";

export type SupervisorCursor = {
  outlet?: string;
  date: string;
  reviewType?: string;
  reviewId?: string;
  depositId?: string;
};

const TTL_MIN = Number(process.env.WA_SESSION_TTL_MIN || 120);

function todayLocalISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isSessionValid(sess: any) {
  if (!sess?.code || sess.role !== "supervisor") return false;
  const updatedAt = new Date(sess.updatedAt).getTime();
  return Date.now() - updatedAt <= TTL_MIN * 60 * 1000;
}

async function sendLoginLink(phoneGraph: string) {
  await sendText(phoneGraph, `You're not logged in. Tap to log in: ${process.env.APP_ORIGIN}/login`);
}

async function saveSession(sessId: string, patch: Partial<{ state: string; cursor: SupervisorCursor }>) {
  await (prisma as any).waSession.update({ where: { id: sessId }, data: { ...patch } });
}

function mapFilterToType(id: string): string | undefined {
  switch (id) {
    case "SUP_FILTER_WASTE":
      return "waste";
    case "SUP_FILTER_EXPENSE":
      return "expense";
    case "SUP_FILTER_DEPOSIT":
      return "deposit";
    case "SUP_FILTER_DISPUTE":
      return "supply_dispute";
    case "SUP_FILTER_MOD":
      return "supply_mod_request";
    default:
      return undefined; // All
  }
}

async function getPendingReviewItems(type: string | undefined, date: string, outlet?: string) {
  const where: any = { status: "pending" };
  if (type) where.type = type;
  if (outlet) where.outlet = outlet;
  // date is DateTime; filter recent (last 3 days) to keep list relevant
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  where.date = { gte: since };
  const items = await (prisma as any).reviewItem.findMany({ where, orderBy: { createdAt: "desc" }, take: 10 });
  return items as any[];
}

function compactReviewText(item: any) {
  const p = (item?.payload as any) || {};
  const head = String(item?.type || "").replace(/_/g, " ").toUpperCase();
  const outlet = item?.outlet || "-";
  const date = new Date(item?.date || new Date()).toISOString().slice(0, 10);
  const detail = p?.summary || p?.reason || p?.itemKey || "";
  return `${head} • ${outlet}\n${date}\n${detail}`.slice(0, 300);
}

function compactDepositLine(dep: any) {
  const note = dep?.note || "";
  return `${dep?.outletName || "?"} — Ksh ${dep?.amount} — ${dep?.status} — ${note}`;
}

export async function handleSupervisorAction(sess: any, replyId: string, phoneE164: string) {
  const gp = toGraphPhone(phoneE164);
  const today = todayLocalISO();
  if (!isSessionValid(sess)) return sendLoginLink(gp);

  switch (replyId) {
    case "SUP_REVIEW": {
      await saveSession(sess.id, { state: "SUP_REVIEW_PICK_FILTER", cursor: { ...(sess.cursor as any), date: today } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildReviewFilterButtons() as any });
    }
    case "SUP_FILTER_ALL":
    case "SUP_FILTER_WASTE":
    case "SUP_FILTER_EXPENSE":
    case "SUP_FILTER_DEPOSIT":
    case "SUP_FILTER_DISPUTE":
    case "SUP_FILTER_MOD": {
      const filter = mapFilterToType(replyId);
      const cur: SupervisorCursor = { ...(sess.cursor as any), date: today, reviewType: filter };
      const items = await getPendingReviewItems(filter, today, cur.outlet);
      await saveSession(sess.id, { state: "SUP_REVIEW_LIST", cursor: cur });
      if (!items.length) {
        await sendText(gp, "No pending items.");
        return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu(cur.outlet) as any });
      }
      const rows = items.map((i) => ({ id: i.id, title: `${String(i.type || "").replace(/_/g, " ")}`, desc: `${new Date(i.date).toISOString().slice(0, 10)} • ${i.outlet}` }));
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildReviewList(rows) as any });
    }
    case "SUP_TXNS": {
      // Top 10 today; if none, last 3 days
      let deps = await (prisma as any).attendantDeposit.findMany({ where: { date: today }, orderBy: { createdAt: "desc" }, take: 10 });
      if (!deps.length) {
        const since = new Date(Date.now() - 3 * 24 * 3600 * 1000);
        deps = await (prisma as any).attendantDeposit.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 10 });
      }
      if (!deps.length) {
        await sendText(gp, "No deposits.");
        return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any });
      }
      const items = deps.map((d: any) => ({ id: d.id, line: compactDepositLine(d) }));
      await saveSession(sess.id, { state: "SUP_DEPOSIT_LIST", cursor: { ...(sess.cursor as any), date: today } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildDepositList(items) as any });
    }
    case "SUP_REPORT": {
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSummaryChoiceButtons() as any });
    }
    case "SUP_SUMMARY_ALL": {
      const text = await computeSummaryText(today, undefined);
      await sendText(gp, text);
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any });
    }
  }

  // Dynamic handlers
  if (replyId.startsWith("SUP_R:")) {
    const id = replyId.split(":")[1]!;
    const item = await (prisma as any).reviewItem.findUnique({ where: { id } });
    if (!item) {
      await sendText(gp, "Item not found.");
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any });
    }
    await saveSession(sess.id, { state: "SUP_REVIEW_ITEM", cursor: { ...(sess.cursor as any), reviewId: id, date: today } });
    await sendText(gp, compactReviewText(item));
    return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildApproveReject(id) as any });
  }

  if (replyId.startsWith("SUP_APPROVE:")) {
    const id = replyId.split(":")[1]!;
    await (prisma as any).reviewItem.update({ where: { id }, data: { status: "approved" } });
    await sendText(gp, "Approved ✅");
    await saveSession(sess.id, { state: "SUP_MENU", cursor: { ...(sess.cursor as any), date: today } });
    return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any });
  }

  if (replyId.startsWith("SUP_REJECT:")) {
    await saveSession(sess.id, { state: "SUP_REVIEW_ITEM", cursor: { ...(sess.cursor as any), date: today } });
    return sendText(gp, "Send a short reason (max 200 chars).");
  }

  if (replyId.startsWith("SUP_D:")) {
    const id = replyId.split(":")[1]!;
    const dep = await (prisma as any).attendantDeposit.findUnique({ where: { id } });
    if (!dep) {
      await sendText(gp, "Deposit not found.");
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any });
    }
    await saveSession(sess.id, { state: "SUP_DEPOSIT_ITEM", cursor: { ...(sess.cursor as any), depositId: id, date: today } });
    await sendText(gp, compactDepositLine(dep));
    return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildDepositModerationButtons(id) as any });
  }

  if (replyId.startsWith("SUP_D_VALID:")) {
    const id = replyId.split(":")[1]!;
    await (prisma as any).attendantDeposit.update({ where: { id }, data: { status: "VALID" } });
    try {
      const dep = await (prisma as any).attendantDeposit.findUnique({ where: { id } });
      if (dep) {
        await notifyAttendants(dep.outletName, `Deposit VALID: KSh ${dep.amount} (${dep.note || "ref"})`);
        await notifySupplier(dep.outletName, `Deposit VALID for ${dep.outletName}: KSh ${dep.amount}`);
      }
    } catch {}
    await sendText(gp, "Marked VALID ✅");
    await saveSession(sess.id, { state: "SUP_MENU", cursor: { ...(sess.cursor as any), date: today } });
    return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any });
  }

  if (replyId.startsWith("SUP_D_INVALID:")) {
    await saveSession(sess.id, { state: "SUP_DEPOSIT_ITEM", cursor: { ...(sess.cursor as any), date: today } });
    return sendText(gp, "Send a short reason for invalidation.");
  }

  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any });
}

// Text handler: consumes free-text reasons for reject/invalid flows
export async function handleSupervisorText(sess: any, text: string, phoneE164: string) {
  const gp = toGraphPhone(phoneE164);
  if (!isSessionValid(sess)) return sendLoginLink(gp);

  const cur: SupervisorCursor = (sess.cursor as any) || { date: todayLocalISO() };
  const today = cur.date || todayLocalISO();

  if ((sess.state as SupervisorState) === "SUP_REVIEW_ITEM" && cur.reviewId) {
    const reason = String(text || "").slice(0, 200);
    // Merge reason into payload
    const item = await (prisma as any).reviewItem.findUnique({ where: { id: cur.reviewId } });
    const payload = { ...(item?.payload as any), reason };
    await (prisma as any).reviewItem.update({ where: { id: cur.reviewId }, data: { status: "rejected", payload } });
    await sendText(gp, "Rejected ❌");
    await saveSession(sess.id, { state: "SUP_MENU", cursor: { ...cur, date: today, reviewId: undefined } });
    return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu(cur.outlet) as any });
  }

  if ((sess.state as SupervisorState) === "SUP_DEPOSIT_ITEM" && cur.depositId) {
    const reason = String(text || "").slice(0, 200);
    const dep = await (prisma as any).attendantDeposit.findUnique({ where: { id: cur.depositId } });
    const newNote = `${dep?.note || ""}${reason ? ` | invalid: ${reason}` : ""}`.slice(0, 200);
    await (prisma as any).attendantDeposit.update({ where: { id: cur.depositId }, data: { status: "INVALID", note: newNote } });
    try {
      if (dep) {
        await notifyAttendants(dep.outletName, `Deposit INVALID: KSh ${dep.amount} (${dep.note || "ref"}). Reason: ${reason}`);
        await notifySupplier(dep.outletName, `Deposit INVALID for ${dep.outletName}: KSh ${dep.amount}. Reason: ${reason}`);
      }
    } catch {}
    await sendText(gp, "Marked INVALID ❌");
    await saveSession(sess.id, { state: "SUP_MENU", cursor: { ...cur, date: today, depositId: undefined } });
    return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu(cur.outlet) as any });
  }

  // Default
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu(cur.outlet) as any });
}

async function computeSummaryText(date: string, outlet?: string) {
  const whereOutlet: any = outlet ? { outletName: outlet } : {};
  const closings = await (prisma as any).attendantClosing.count({ where: { date, ...whereOutlet } });
  const expenses = await (prisma as any).attendantExpense.findMany({ where: { date, ...whereOutlet } });
  const expenseSum = (expenses || []).reduce((s: number, e: any) => s + (e.amount || 0), 0);
  const deposits = await (prisma as any).attendantDeposit.findMany({ where: { date, status: "VALID", ...whereOutlet } });
  const depositSum = (deposits || []).reduce((s: number, d: any) => s + (d.amount || 0), 0);
  const deliveries = await (prisma as any).supplyOpeningRow.count({ where: { date, ...(outlet ? { outletName: outlet } : {}) } });
  const head = outlet ? `${outlet} • ${date}` : `All Outlets • ${date}`;
  return `${head}\nDeliveries: ${deliveries}\nClosings: ${closings}\nExpenses: KSh ${expenseSum}\nDeposits: KSh ${depositSum}`;
}
 
