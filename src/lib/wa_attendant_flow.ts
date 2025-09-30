// New state machine for attendants.
import { prisma } from "@/lib/db";
import { sendText, sendInteractive } from "@/lib/wa";
import {
  menuMain,
  listProducts,
  promptQty,
  buttonsWasteOrSkip,
  promptWaste,
  summarySubmitModify,
  expenseNamePrompt,
  expenseAmountPrompt,
  expenseFollowupButtons,
} from "@/lib/wa_messages";
import { saveClosings } from "@/server/closings";
import { computeDayTotals } from "@/server/finance";
import { addDeposit, parseMpesaText } from "@/server/deposits";
import { getAssignedProducts } from "@/server/products";

type Cursor = {
  date: string;
  rows: Array<{ key: string; name: string; closing: number; waste: number }>;
  currentItem?: { key: string; name: string; closing?: number; waste?: number };
  expenseName?: string;
};

type SessionPatch = Partial<Cursor & { state: string; role?: string; code?: string; outlet?: string }>;

async function loadSession(phone: string) {
  const phoneE164 = phone.startsWith("+") ? phone : "+" + phone;
  const s = await (prisma as any).waSession.findUnique({ where: { phoneE164 } });
  return (
    s ||
    (await (prisma as any).waSession.create({ data: { phoneE164, role: "attendant", state: "SPLASH", cursor: { date: today(), rows: [] } } }))
  );
}

async function saveSession(phone: string, patch: SessionPatch) {
  const phoneE164 = phone.startsWith("+") ? phone : "+" + phone;
  const s = await loadSession(phoneE164);
  const prevCursor = (s.cursor as any) || {};
  const cursorPatch: any = {};
  if ("date" in patch) cursorPatch.date = (patch as any).date;
  if ("rows" in patch) cursorPatch.rows = (patch as any).rows;
  if ("currentItem" in patch) cursorPatch.currentItem = (patch as any).currentItem;
  if ("expenseName" in patch) cursorPatch.expenseName = (patch as any).expenseName;
  const cursor = { ...prevCursor, ...cursorPatch };
  return (prisma as any).waSession.update({
    where: { id: s.id },
    data: {
      state: patch.state || s.state,
      code: patch.code ?? s.code,
      role: patch.role ?? s.role,
      outlet: patch.outlet ?? s.outlet,
      cursor,
    },
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function inactiveExpired(updatedAt: Date) {
  return Date.now() - new Date(updatedAt).getTime() > 30 * 60 * 1000;
}

function isNumericText(t: string) {
  return /^\d+(?:\.\d+)?$/.test(t.trim());
}

function upsertRow(cursor: Cursor, key: string, patch: Partial<{ closing: number; waste: number; name: string }>) {
  cursor.rows ||= [] as any;
  let r = cursor.rows.find((x) => x.key === key);
  if (!r) {
    r = { key, name: patch.name || key, closing: 0, waste: 0 };
    cursor.rows.push(r);
  }
  Object.assign(r, patch);
}

export async function handleInboundText(phone: string, text: string) {
  const s = await loadSession(phone);
  const t = text.trim();
  const cur: Cursor = (s.cursor as any) || { date: today(), rows: [] };

  // Inactivity reset
  if (inactiveExpired(s.updatedAt)) {
    await saveSession(phone, { state: "MENU", date: today(), rows: [] });
    await sendInteractive(menuMain(phone, s.outlet || undefined));
    return;
  }

  // Global commands
  if (/^(HELP)$/i.test(t)) {
    await sendText(phone, "HELP: MENU, TXNS, SWITCH, LOGOUT. During entry: numbers only (e.g., 9.5). Paste M-Pesa SMS to record deposit.");
    return;
  }
  if (/^(SWITCH|LOGOUT)$/i.test(t)) {
    await saveSession(phone, { state: "SPLASH", role: undefined, code: undefined, outlet: undefined, date: today(), rows: [] });
    await sendText(
      phone,
      "Welcome to BarakaOps.\n1) Attendant  2) Supervisor  3) Supplier\nReply 1/2/3 or open barakafresh.com/wa/login"
    );
    return;
  }
  if (/^(TXNS)$/i.test(t)) {
    if (!s.code || !s.outlet) {
      await sendText(phone, "Login first (send your code).");
      return;
    }
    const rows = await (prisma as any).attendantDeposit.findMany({
      where: { outletName: s.outlet, date: cur.date },
      take: 10,
      orderBy: { createdAt: "desc" },
    });
    if (!rows.length) {
      await sendText(phone, "No deposits yet today.");
    } else {
      await sendText(
        phone,
        rows.map((r: any) => `• ${r.amount} (${r.status}) ${r.note ? `ref ${r.note}` : ""}`).join("\n")
      );
    }
    return;
  }

  // SPLASH → LOGIN
  if (s.state === "SPLASH") {
    await sendText(
      phone,
      "Welcome to BarakaOps.\n1) Attendant  2) Supervisor  3) Supplier\nReply 1/2/3 or open barakafresh.com/wa/login"
    );
    await saveSession(phone, { state: "LOGIN" });
    return;
  }

  if (s.state === "LOGIN") {
    // role choice
    if (/^[123]$/.test(t)) {
      const role = t === "1" ? "attendant" : t === "2" ? "supervisor" : "supplier";
      await saveSession(phone, { role, state: "LOGIN" });
      await sendText(phone, "Send your code to continue.");
      return;
    }
    // code entry
    const mapping = await (prisma as any).phoneMapping.findFirst({ where: { code: t } });
    if (mapping) {
      await saveSession(phone, { role: mapping.role, code: mapping.code, outlet: mapping.outlet || undefined, state: "MENU", date: today(), rows: [] });
      await sendInteractive(menuMain(phone, mapping.outlet || undefined));
    } else {
      await sendText(phone, "Code not found. Try again or contact your supervisor.");
    }
    return;
  }

  // MENU context
  if (/^MENU$/i.test(t) || s.state === "MENU") {
    if (/^MENU$/i.test(t)) {
      await sendInteractive(menuMain(phone, s.outlet || undefined));
      return;
    }
    // Otherwise user may send arbitrary text; guide them back
    // Fallthrough to next state handlers below
  }

  // CLOSING_QTY numeric gate
  if (s.state === "CLOSING_QTY") {
    if (isNumericText(t)) {
      const val = Number(t);
      const item = cur.currentItem;
      if (!item) {
        await sendText(phone, "Pick a product first.");
        return;
      }
      item.closing = val;
      await saveSession(phone, { state: "CLOSING_QTY", ...cur });
      await sendInteractive(buttonsWasteOrSkip(phone, item.name));
    } else {
      await sendText(phone, "Numbers only, e.g. 9.5");
    }
    return;
  }

  // CLOSING_WASTE_QTY numeric gate
  if (s.state === "CLOSING_WASTE_QTY") {
    if (isNumericText(t)) {
      const val = Number(t);
      const item = cur.currentItem;
      if (!item) {
        await sendText(phone, "Pick a product first.");
        return;
      }
      item.waste = val;
      upsertRow(cur, item.key, { name: item.name, closing: item.closing || 0, waste: item.waste || 0 });
      delete cur.currentItem;
      await nextPickOrSummary(phone, s, cur);
    } else {
      await sendText(phone, "Numbers only, e.g. 1.0");
    }
    return;
  }

  // EXPENSE states
  if (s.state === "EXPENSE_NAME") {
    cur.expenseName = t;
    await saveSession(phone, { state: "EXPENSE_AMOUNT", ...cur });
    await sendText(phone, `Enter amount for ${t}. Numbers only, e.g. 250`);
    return;
  }
  if (s.state === "EXPENSE_AMOUNT") {
    if (!isNumericText(t)) {
      await sendText(phone, "Numbers only, e.g. 250");
      return;
    }
    const amount = Number(t);
    if (!s.outlet) {
      await sendText(phone, "No outlet bound. Ask supervisor.");
      return;
    }
    await (prisma as any).attendantExpense.create({ data: { date: cur.date, outletName: s.outlet, name: cur.expenseName || "Expense", amount } });
    await saveSession(phone, { state: "MENU", ...cur, expenseName: undefined });
    await sendInteractive(expenseFollowupButtons(phone));
    return;
  }

  // WAIT_DEPOSIT: parse M-Pesa
  if (s.state === "WAIT_DEPOSIT") {
    const parsed = parseMpesaText(t);
    if (parsed) {
      if (!s.outlet) {
        await sendText(phone, "No outlet bound. Ask supervisor.");
        return;
      }
      await addDeposit({ outletName: s.outlet, amount: parsed.amount, note: parsed.ref, date: cur.date, code: s.code || undefined });
      await sendText(phone, `Deposit recorded: Ksh ${parsed.amount} (ref ${parsed.ref}). Send TXNS to view.`);
      return;
    }
    await sendText(phone, "Paste the original M-Pesa SMS (no edits).");
    return;
  }

  // Default: compact help
  await sendText(phone, "Try MENU or HELP.");
}

export async function handleInteractiveReply(phone: string, payload: any) {
  const s = await loadSession(phone);
  const cur: Cursor = (s.cursor as any) || { date: today(), rows: [] };
  const lr = payload?.list_reply?.id as string | undefined;
  const br = payload?.button_reply?.id as string | undefined;
  const id = lr || br || "";

  // Interpret menu choices
  if (id === "MENU_SUBMIT_CLOSING") {
    if (!s.code || !s.outlet) {
      await sendText(phone, "Login first (send your code).");
      return;
    }
    const prods = await getAssignedProducts(s.code);
    await saveSession(phone, { state: "CLOSING_PICK", ...cur });
    await sendInteractive(listProducts(phone, prods, s.outlet));
    return;
  }
  if (id === "MENU_EXPENSE") {
    await saveSession(phone, { state: "EXPENSE_NAME", ...cur });
    await sendInteractive(expenseNamePrompt(phone));
    return;
  }
  if (id === "MENU_TXNS") {
    const rows = await (prisma as any).attendantDeposit.findMany({ where: { outletName: s.outlet, date: cur.date }, take: 10, orderBy: { createdAt: "desc" } });
    if (!rows.length) await sendText(phone, "No deposits yet today.");
    else await sendText(phone, rows.map((r: any) => `• ${r.amount} (${r.status}) ${r.note ? `ref ${r.note}` : ""}`).join("\n"));
    return;
  }

  // List product selection
  if (id.startsWith("PROD_")) {
    const key = id.replace(/^PROD_/, "");
    const prods = await getAssignedProducts(s.code || "");
    const name = prods.find((p) => p.key === key)?.name || key;
    cur.currentItem = { key, name };
    await saveSession(phone, { state: "CLOSING_QTY", ...cur });
    await sendInteractive(promptQty(phone, name));
    return;
  }

  // Waste/Skip buttons
  if (id === "WASTE_YES") {
    if (!cur.currentItem) {
      await sendText(phone, "Pick a product first.");
      return;
    }
    await saveSession(phone, { state: "CLOSING_WASTE_QTY", ...cur });
    await sendInteractive(promptWaste(phone, cur.currentItem.name));
    return;
  }
  if (id === "WASTE_SKIP") {
    if (!cur.currentItem) {
      await sendText(phone, "Pick a product first.");
      return;
    }
    cur.currentItem.waste = 0;
    upsertRow(cur, cur.currentItem.key, { name: cur.currentItem.name, closing: cur.currentItem.closing || 0, waste: 0 });
    delete cur.currentItem;
    await nextPickOrSummary(phone, s, cur);
    return;
  }

  // Summary actions
  if (id === "SUMMARY_SUBMIT") {
    if (!s.outlet) {
      await sendText(phone, "No outlet bound. Ask supervisor.");
      return;
    }
    // Guard against duplicates is handled by DB unique constraint
    await saveClosings({
      date: cur.date,
      outletName: s.outlet,
      rows: cur.rows.map((r) => ({ productKey: r.key, closingQty: r.closing, wasteQty: r.waste })),
    });
    const totals = await computeDayTotals({ date: cur.date, outletName: s.outlet });
    await saveSession(phone, { state: "WAIT_DEPOSIT", ...cur });
    await sendText(
      phone,
      `Thanks, ${s.code || "Attendant"} (${s.outlet}).\nExpected deposit today: Ksh ${totals.expectedDeposit}.\nPaste your M-Pesa message here when paid.`
    );
    return;
  }
  if (id === "SUMMARY_MODIFY") {
    if (!cur.rows.length) {
      await sendText(phone, "No rows yet. Pick a product first.");
      return;
    }
    const items = cur.rows.map((r) => ({ key: r.key, name: r.name }));
    await saveSession(phone, { state: "CLOSING_PICK", ...cur });
    await sendInteractive(listProducts(phone, items, s.outlet || "Outlet"));
    return;
  }
}

async function nextPickOrSummary(phone: string, s: any, cur: Cursor) {
  const prods = await getAssignedProducts(s.code || "");
  const remaining = prods.filter((p) => !cur.rows.some((r) => r.key === p.key));
  if (!remaining.length) {
    await saveSession(phone, { state: "SUMMARY", ...cur });
    await sendInteractive(summarySubmitModify(phone, cur.rows, s.outlet || "Outlet"));
  } else {
    await saveSession(phone, { state: "CLOSING_PICK", ...cur });
    await sendInteractive(listProducts(phone, remaining, s.outlet || "Outlet"));
  }
}
