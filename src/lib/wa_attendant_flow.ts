// New state machine for attendants.
import { prisma } from "@/lib/prisma";
import { sendText, sendInteractive } from "@/lib/wa";
import { normCode, toDbPhone } from "@/server/util/normalize";
import { createLoginLink } from "@/server/wa_links";
import { touchSession } from "@/server/wa/session";
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
import { sendAttendantMenu, sendSupervisorMenu, sendSupplierMenu } from "@/lib/wa_menus";

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

function looksLikeCode(t: string) {
  return /^[A-Za-z0-9]{3,10}$/.test(String(t || "").trim());
}

async function promptLogin(phone: string) {
  // Generate a per-phone login link that carries wa + nonce
  const urlObj = await createLoginLink(toDbPhone(phone));
  await sendText(
    phone,
    `You're not logged in. Tap this link to log in via the website:\n${urlObj.url}\nAfter verifying your code, we'll greet you here.`
  );
  // Optional: provide a helper button to re-send the link later
  await sendInteractive({
    to: phone.replace(/^\+/, ""),
    type: "button",
    body: { text: "Need the login link again?" },
    action: { buttons: [
      { type: "reply", reply: { id: "SEND_LOGIN_LINK", title: "Send login link" } },
      { type: "reply", reply: { id: "HELP", title: "Help" } },
    ] },
  } as any);
}

// Helper: bind phone to code/role and enter MENU (reuses existing mapping + outlet logic)
async function bindPhoneAndEnterMenu({ phoneE164, code, role }: { phoneE164: string; code: string; role?: string }) {
  const pc = await (prisma as any).personCode.findFirst({ where: { code: { equals: code, mode: "insensitive" }, active: true } });
  if (!pc) return false;
  const finalRole = role || pc.role;

  // Phone mapping
  const existing = await (prisma as any).phoneMapping.findUnique({ where: { code: pc.code } });
  if (existing && existing.phoneE164 && existing.phoneE164 !== phoneE164) return false;
  if (!existing) await (prisma as any).phoneMapping.create({ data: { code: pc.code, role: finalRole, phoneE164, outlet: null } });

  // Resolve outlet (attendants)
  let outlet = null as string | null;
  if (finalRole === "attendant") {
    const pm = await (prisma as any).phoneMapping.findUnique({ where: { code: pc.code } });
    outlet = pm?.outlet || null;
    if (!outlet) {
      const scope = await (prisma as any).attendantScope.findUnique({ where: { codeNorm: pc.code } });
      outlet = scope?.outletName || null;
    }
    if (!outlet) {
      // Save minimal state and prompt supervisor assignment
      await (prisma as any).waSession.upsert({
        where: { phoneE164 },
        update: { code: pc.code, role: finalRole, state: "LOGIN" },
        create: { phoneE164, code: pc.code, role: finalRole, state: "LOGIN", cursor: { date: today(), rows: [] } },
      });
      await sendText(phoneE164.replace(/^\+/, ""), "Your outlet is not set. Ask Supervisor to assign your outlet.");
      return true;
    }
  }

  // Enter MENU and send menu
  await (prisma as any).waSession.upsert({
    where: { phoneE164 },
    update: { code: pc.code, role: finalRole, outlet, state: "MENU", cursor: { date: today(), rows: [] } },
    create: { phoneE164, code: pc.code, role: finalRole, outlet, state: "MENU", cursor: { date: today(), rows: [] } },
  });

  const to = phoneE164.replace(/^\+/, "");
  if (finalRole === "attendant") await sendAttendantMenu(to, outlet || "your outlet");
  else if (finalRole === "supervisor") await sendSupervisorMenu(to);
  else await sendSupplierMenu(to);
  return true;
}

// Accept either "LOGIN <CODE>" or "LINK <NONCE>"
async function tryAutoLinkLogin(text: string, phoneE164: string) {
  const T = String(text || "").trim().toUpperCase();
  // a) LINK <NONCE>
  const mLink = T.match(/^LINK\s+([A-Z0-9]{4,8})$/);
  if (mLink) {
    const nonce = mLink[1];
    const linkPhone = `+LINK:${nonce}`;
    const link = await (prisma as any).waSession.findUnique({ where: { phoneE164: linkPhone } });
    if (!link?.cursor || !link?.code || !link?.role) return false;
    const pc = await (prisma as any).personCode.findUnique({ where: { code: link.code } });
    if (!pc || !pc.active) return false;
    const ok = await bindPhoneAndEnterMenu({ phoneE164, code: pc.code, role: pc.role });
    if (!ok) return false;
    await (prisma as any).waSession.delete({ where: { phoneE164: linkPhone } }).catch(() => {});
    await sendText(phoneE164.replace(/^\+/, ""), `Welcome ${pc.role} — login successful.`);
    return true;
  }
  // NOTE: We no longer accept LOGIN <CODE> in chat. Use website finalize flow instead.
  return false;
}

export async function handleInboundText(phone: string, text: string) {
  const s = await loadSession(phone);
  // Touch session activity
  if (s?.id) await touchSession(s.id);
  const t = text.trim();
  const cur: Cursor = (s.cursor as any) || { date: today(), rows: [] };

  // Try one-tap link login first
  const phoneE164 = phone.startsWith("+") ? phone : "+" + phone;
  const auto = await tryAutoLinkLogin(t, phoneE164);
  if (auto) return;

  // Inactivity reset
  if (inactiveExpired(s.updatedAt)) {
    if (s.code && s.outlet) {
      await saveSession(phone, { state: "MENU", date: today(), rows: [] });
      await sendInteractive(menuMain(phone, s.outlet || undefined));
    } else {
      await saveSession(phone, { state: "LOGIN", date: today(), rows: [] });
      await promptLogin(phone);
    }
    return;
  }

  // Global commands
  if (/^(HELP)$/i.test(t)) {
    if (!s.code) {
      await sendText(phone, "You're not logged in. Use the login link we sent above to continue.");
    } else {
      await sendText(phone, "HELP: MENU, TXNS, LOGOUT. During entry: numbers only (e.g., 9.5). Paste M-Pesa SMS to record deposit.");
    }
    return;
  }
  if (/^(SWITCH|LOGOUT|RESET)$/i.test(t)) {
    // Clear code/outlet and move to LOGIN
    try {
      await (prisma as any).waSession.update({
        where: { id: s.id },
        data: { code: null, outlet: null, state: "LOGIN", cursor: {} as any },
      });
    } catch {}
    await sendText(phone, "You've been logged out. We'll send you a login link now.");
    await promptLogin(phone);
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
    await promptLogin(phone);
    await saveSession(phone, { state: "LOGIN" });
    return;
  }

  if (s.state === "LOGIN") {
    // Do not accept codes in chat. Always send a login link to finalize on the website.
    await sendText(phone, "We no longer accept codes in chat. Use the login link to continue.");
    await promptLogin(phone);
    return;
  }

  // MENU context
  if (/^MENU$/i.test(t) || s.state === "MENU") {
    if (!s.code || !s.outlet) {
      await sendText(phone, "You're not logged in. Send your login code (e.g., BR1234).");
      return;
    }
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
  if (!s.code) await sendText(phone, "You're not logged in. Use the login link to continue.");
  else await sendText(phone, "Try MENU or HELP.");
}

export async function handleInteractiveReply(phone: string, payload: any) {
  const s = await loadSession(phone);
  if (s?.id) await touchSession(s.id);
  const cur: Cursor = (s.cursor as any) || { date: today(), rows: [] };
  const lr = payload?.list_reply?.id as string | undefined;
  const br = payload?.button_reply?.id as string | undefined;
  const id = lr || br || "";

  // Login link resend handler
  if (id === "SEND_LOGIN_LINK") {
    const link = await createLoginLink(toDbPhone(phone));
    await sendText(phone, `Tap to log in via the website:\n${link.url}`);
    return;
  }

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
