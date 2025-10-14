// server/wa/wa_supervisor_flow.ts
// Clean single-definition supervisor WhatsApp flow (review, deposits, summary)
import { prisma } from "@/lib/prisma";
import { sendText, sendInteractive } from "@/lib/wa";
import { createLoginLink } from "@/server/wa_links";
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
  await sendText(phoneGraph, `You're not logged in. Tap to log in: ${process.env.APP_ORIGIN}/login`, "AI_DISPATCH_TEXT", { gpt_sent: true });
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
    case "LOGOUT": {
      // Clear session and send a single concise logout message with login link
      try { await (prisma as any).waSession.update({ where: { id: sess.id }, data: { state: 'LOGIN', code: null, outlet: null } }); } catch {}
      try {
        const urlObj = await createLoginLink(phoneE164);
        await sendText(gp, `You've been logged out. Tap this link to log in via the website:\n${urlObj.url}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      } catch {
        await sendText(gp, "You've been logged out.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      }
      return;
    }
    case "SUP_REVIEW": {
      await saveSession(sess.id, { state: "SUP_REVIEW_PICK_FILTER", cursor: { ...(sess.cursor as any), date: today } });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildReviewFilterButtons() as any }, "AI_DISPATCH_INTERACTIVE");
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
  await sendText(gp, "No pending items.", "AI_DISPATCH_TEXT", { gpt_sent: true });
        return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu(cur.outlet) as any }, "AI_DISPATCH_INTERACTIVE");
      }
      const rows = items.map((i) => ({ id: i.id, title: `${String(i.type || "").replace(/_/g, " ")}`, desc: `${new Date(i.date).toISOString().slice(0, 10)} • ${i.outlet}` }));
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildReviewList(rows) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    case "SUP_TXNS": {
      // Top 10 today; if none, last 3 days
      let deps = await (prisma as any).attendantDeposit.findMany({ where: { date: today }, orderBy: { createdAt: "desc" }, take: 10 });
      if (!deps.length) {
        const since = new Date(Date.now() - 3 * 24 * 3600 * 1000);
        deps = await (prisma as any).attendantDeposit.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 10 });
      }
      if (!deps.length) {
        await sendText(gp, "No deposits.", "AI_DISPATCH_TEXT", { gpt_sent: true });
        return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any }, "AI_DISPATCH_INTERACTIVE");
      }
      const items = deps.map((d: any) => ({ id: d.id, line: compactDepositLine(d) }));
      await saveSession(sess.id, { state: "SUP_DEPOSIT_LIST", cursor: { ...(sess.cursor as any), date: today } });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildDepositList(items) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    case "SUP_REPORT": {
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSummaryChoiceButtons() as any }, "AI_DISPATCH_INTERACTIVE");
    }
    case "SUP_SUMMARY_ALL": {
      const text = await computeSummaryText(today, undefined);
  await sendText(gp, text, "AI_DISPATCH_TEXT", { gpt_sent: true });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any }, "AI_DISPATCH_INTERACTIVE");
    }
  }

  // Dynamic handlers
  if (replyId.startsWith("SUP_R:")) {
    const id = replyId.split(":")[1]!;
    const item = await (prisma as any).reviewItem.findUnique({ where: { id } });
    if (!item) {
      await sendText(gp, "Item not found.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    await saveSession(sess.id, { state: "SUP_REVIEW_ITEM", cursor: { ...(sess.cursor as any), reviewId: id, date: today } });
    // Provide richer details for supply_dispute_item
    let detail = compactReviewText(item);
    if (item.type === 'supply_dispute_item') {
      const p = (item.payload || {}) as any;
      detail = [
        `SUPPLY DISPUTE • ${(item.outlet || '-')}`,
        `${new Date(item.date).toISOString().slice(0,10)} • Item ${p.itemKey}`,
        `Recorded: ${p.recordedQty}${p.unit || ''}`,
        `Claimed: ${p.claimedQty}${p.unit || ''}`,
        `Reason: ${p.reasonText || p.reasonCode}`,
        `Ref: ${p.rowId || 'row'}`,
        '',
        'Approve = adjust opening qty to claimed. Reject = keep recorded.'
      ].join('\n');
    }
    await sendText(gp, detail, "AI_DISPATCH_TEXT", { gpt_sent: true });
    return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildApproveReject(id) as any }, "AI_DISPATCH_INTERACTIVE");
  }

  if (replyId.startsWith("SUP_APPROVE:")) {
    const id = replyId.split(":")[1]!;
    const item = await (prisma as any).reviewItem.findUnique({ where: { id } });
    if (item?.type === 'supply_dispute_item') {
      const p = (item.payload || {}) as any;
      // Adjust opening row to claimedQty if rowId lookup succeeds
      if (p?.rowId && Number(p.claimedQty) >= 0) {
        try {
          const row = await (prisma as any).supplyOpeningRow.findUnique({ where: { id: p.rowId } });
          if (row) {
            await (prisma as any).supplyOpeningRow.update({ where: { id: p.rowId }, data: { qty: p.claimedQty } });
          }
        } catch {}
      }
      const payload = { ...p, resolvedAt: new Date().toISOString(), resolution: 'approved', adjustedQty: p.claimedQty, supervisorCode: sess.code };
      await (prisma as any).reviewItem.update({ where: { id }, data: { status: 'approved', payload } });
      // Notify attendant if phone can be inferred via attendantCode mapping
      try {
        if (p.attendantCode) {
          const pm = await (prisma as any).phoneMapping.findUnique({ where: { code: p.attendantCode } });
          if (pm?.phoneE164) await sendText(toGraphPhone(pm.phoneE164), `Dispute approved: ${p.itemKey} adjusted to ${p.claimedQty}${p.unit || ''}.`, 'AI_DISPATCH_TEXT', { gpt_sent: true });
        }
      } catch {}
    } else {
      await (prisma as any).reviewItem.update({ where: { id }, data: { status: "approved" } });
    }
    await sendText(gp, "Approved ✅", "AI_DISPATCH_TEXT", { gpt_sent: true });
    await saveSession(sess.id, { state: "SUP_MENU", cursor: { ...(sess.cursor as any), date: today } });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any }, "AI_DISPATCH_INTERACTIVE");
  }

  if (replyId.startsWith("SUP_REJECT:")) {
    await saveSession(sess.id, { state: "SUP_REVIEW_ITEM", cursor: { ...(sess.cursor as any), date: today } });
  return sendText(gp, "Send a short reason (max 200 chars).", "AI_DISPATCH_TEXT", { gpt_sent: true });
  }

  if (replyId.startsWith("SUP_D:")) {
    const id = replyId.split(":")[1]!;
    const dep = await (prisma as any).attendantDeposit.findUnique({ where: { id } });
    if (!dep) {
      await sendText(gp, "Deposit not found.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    await saveSession(sess.id, { state: "SUP_DEPOSIT_ITEM", cursor: { ...(sess.cursor as any), depositId: id, date: today } });
  await sendText(gp, compactDepositLine(dep), "AI_DISPATCH_TEXT", { gpt_sent: true });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildDepositModerationButtons(id) as any }, "AI_DISPATCH_INTERACTIVE");
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
  await sendText(gp, "Marked VALID ✅", "AI_DISPATCH_TEXT", { gpt_sent: true });
    await saveSession(sess.id, { state: "SUP_MENU", cursor: { ...(sess.cursor as any), date: today } });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any }, "AI_DISPATCH_INTERACTIVE");
  }

  if (replyId.startsWith("SUP_D_INVALID:")) {
    await saveSession(sess.id, { state: "SUP_DEPOSIT_ITEM", cursor: { ...(sess.cursor as any), date: today } });
  return sendText(gp, "Send a short reason for invalidation.", "AI_DISPATCH_TEXT", { gpt_sent: true });
  }

  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu((sess.cursor as any)?.outlet) as any }, "AI_DISPATCH_INTERACTIVE");
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
    if (item?.type === 'supply_dispute_item') {
      const p = (item.payload || {}) as any;
      const payload = { ...p, reasonSupervisor: reason, resolvedAt: new Date().toISOString(), resolution: 'rejected', supervisorCode: sess.code };
      await (prisma as any).reviewItem.update({ where: { id: cur.reviewId }, data: { status: 'rejected', payload } });
      // Notify attendant if possible
      try {
        if (p.attendantCode) {
          const pm = await (prisma as any).phoneMapping.findUnique({ where: { code: p.attendantCode } });
          if (pm?.phoneE164) await sendText(toGraphPhone(pm.phoneE164), `Dispute rejected: ${p.itemKey} kept at ${p.recordedQty}${p.unit || ''}. Reason: ${reason}`, 'AI_DISPATCH_TEXT', { gpt_sent: true });
        }
      } catch {}
      await sendText(gp, "Rejected ❌", "AI_DISPATCH_TEXT", { gpt_sent: true });
    } else {
      const payload = { ...(item?.payload as any), reason };
      await (prisma as any).reviewItem.update({ where: { id: cur.reviewId }, data: { status: "rejected", payload } });
      await sendText(gp, "Rejected ❌", "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
    await saveSession(sess.id, { state: "SUP_MENU", cursor: { ...cur, date: today, reviewId: undefined } });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu(cur.outlet) as any }, "AI_DISPATCH_INTERACTIVE");
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
  await sendText(gp, "Marked INVALID ❌", "AI_DISPATCH_TEXT", { gpt_sent: true });
    await saveSession(sess.id, { state: "SUP_MENU", cursor: { ...cur, date: today, depositId: undefined } });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu(cur.outlet) as any }, "AI_DISPATCH_INTERACTIVE");
  }

  // Default
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupervisorMenu(cur.outlet) as any }, "AI_DISPATCH_INTERACTIVE");
}

export async function computeSummaryText(date: string, outlet?: string) {
  const whereOutlet: any = outlet ? { outletName: outlet } : {};

  // Core activity lines
  const [closings, expenses, deposits, deliveries] = await Promise.all([
    (prisma as any).attendantClosing.count({ where: { date, ...whereOutlet } }),
    (prisma as any).attendantExpense.findMany({ where: { date, ...whereOutlet } }),
    (prisma as any).attendantDeposit.findMany({ where: { date, status: "VALID", ...whereOutlet } }),
    (prisma as any).supplyOpeningRow.count({ where: { date, ...(outlet ? { outletName: outlet } : {}) } }),
  ]);
  const expenseSum = (expenses || []).reduce((s: number, e: any) => s + (e.amount || 0), 0);
  const depositSum = (deposits || []).reduce((s: number, d: any) => s + (d.amount || 0), 0);

  // Commission totals from OutletPerformance (fallback to sum of KPIs)
  let totalCommission = 0;
  if (outlet) {
    const perf = await (prisma as any).outletPerformance.findUnique({ where: { date_outletName: { date, outletName: outlet } } }).catch(() => null);
    totalCommission = Number(perf?.totalCommission || 0);
  } else {
    const perfs = await (prisma as any).outletPerformance.findMany({ where: { date } }).catch(() => []);
    totalCommission = (perfs || []).reduce((s: number, p: any) => s + Number(p?.totalCommission || 0), 0);
  }
  if (!totalCommission) {
    const kpis = await (prisma as any).attendantKPI.findMany({ where: { date, ...whereOutlet } }).catch(() => []);
    totalCommission = (kpis || []).reduce((s: number, k: any) => s + Number(k?.commissionAmount || 0), 0);
  }

  // Top performers by weight and commission
  const topKPIs = await (prisma as any).attendantKPI.findMany({
    where: { date, ...whereOutlet },
    include: { attendant: true },
    orderBy: { commissionAmount: "desc" },
    take: 5,
  }).catch(() => [] as any[]);

  let topCommissionLine = "Top commission: -";
  let topWeightLine = "Top weight: -";
  if (topKPIs && topKPIs.length) {
    const byCommission = [...topKPIs].sort((a: any, b: any) => Number(b.commissionAmount || 0) - Number(a.commissionAmount || 0))[0];
    const byWeight = [...topKPIs].sort((a: any, b: any) => Number(b.totalWeight || 0) - Number(a.totalWeight || 0))[0];
    if (byCommission) {
      const name = (byCommission.attendant as any)?.name || "Attendant";
      const amt = Math.round(Number(byCommission.commissionAmount || 0));
      topCommissionLine = `Top commission: ${name} — KSh ${amt}`;
    }
    if (byWeight) {
      const name = (byWeight.attendant as any)?.name || "Attendant";
      const kg = Number(byWeight.totalWeight || 0);
      topWeightLine = `Top weight: ${name} — ${kg.toFixed(1)} kg`;
    }
  }

  const head = outlet ? `${outlet} • ${date}` : `All Outlets • ${date}`;
  const commissionLine = `Commission: KSh ${Math.round(totalCommission)}`;
  return [
    head,
    `Deliveries: ${deliveries}`,
    `Closings: ${closings}`,
    `Expenses: KSh ${expenseSum}`,
    `Deposits: KSh ${depositSum}`,
    commissionLine,
    topWeightLine,
    topCommissionLine,
  ].join("\n");
}
 
