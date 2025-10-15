// New state machine for attendants.
import { prisma } from "@/lib/prisma";
import { sendText, sendInteractive, logOutbound } from "@/lib/wa";
import { normCode, toDbPhone } from "@/server/util/normalize";
import { createLoginLink } from "@/server/wa_links";
import { touchSession } from "@/server/wa/session";
import {
  listProducts,
  promptQty,
  buttonsWasteOrSkip,
  promptWaste,
  expenseNamePrompt,
  expenseAmountPrompt,
  expenseFollowupButtons,
} from "@/lib/wa_messages";
import { saveClosings } from "@/server/closings";
import { computeDayTotals } from "@/server/finance";
import { addDeposit, parseMpesaText } from "@/server/deposits";
import { getAssignedProducts } from "@/server/products";
import { getTodaySupplySummary } from "@/server/supply";
import { handleSupplyDispute } from "@/server/supply_notify";
import { createReviewItem } from "@/server/review";
import { getWaState, updateWaState, WaState } from "@/lib/wa/state";
import {
  buildButtonPayload,
  buildListPayload,
  buildProductPickerBody,
  buildQuantityPromptText,
  buildNavigationRow,
  buildClosingReviewButtons,
  buildClosingNextActionsButtons,
  buildReviewSummaryText,
} from "@/lib/wa/messageBuilder";
// (sendText) already imported; (prisma) already imported at top

type Cursor = {
  date: string;
  rows: Array<{ key: string; name: string; closing: number; waste: number }>;
  currentItem?: { key: string; name: string; closing?: number; waste?: number };
  expenseName?: string;
  inactiveKeys?: string[]; // once submitted, consider item done for this session
};

// Case-insensitive OpeningEff computation (yesterday closing + today supply)
async function computeOpeningEffective(outletName: string, dateISO: string, itemKey: string): Promise<number> {
  try {
    const keyLc = String(itemKey || '').toLowerCase();
    const dt = new Date(dateISO + "T00:00:00.000Z"); dt.setUTCDate(dt.getUTCDate() - 1);
    const y = dt.toISOString().slice(0, 10);
    const [prevRows, supplyRows] = await Promise.all([
      (prisma as any).attendantClosing.findMany({ where: { date: y, outletName } }).catch(() => []),
      (prisma as any).supplyOpeningRow.findMany({ where: { date: dateISO, outletName } }).catch(() => []),
    ]);
    let openEff = 0;
    for (const r of prevRows || []) {
      const k = String((r as any).itemKey || '').toLowerCase();
      if (k === keyLc) openEff += Number((r as any).closingQty || 0);
    }
    for (const r of supplyRows || []) {
      const k = String((r as any).itemKey || '').toLowerCase();
      if (k === keyLc) openEff += Number((r as any).qty || 0);
    }
    return Number.isFinite(openEff) ? openEff : 0;
  } catch { return 0; }
}

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
  const cursor = { ...prevCursor, ...cursorPatch } as any;
  // Ensure rows array is always present to avoid runtime .find errors
  if (!Array.isArray(cursor.rows)) cursor.rows = [];
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

function prevDateISO(d: string) {
  const dt = new Date((d || today()) + "T00:00:00.000Z");
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function inactiveExpired(updatedAt: Date) {
  return Date.now() - new Date(updatedAt).getTime() > 30 * 60 * 1000;
}

function isNumericText(t: string) {
  return /^\d+(?:\.\d+)?$/.test(t.trim());
}

// Accept inputs like "12kgs", "12 kgs", "kilograms 1.3", "1 2 kgs" → 12, 1.3 etc.
function parseNumericLoose(t: string): number | null {
  if (!t) return null;
  let s = String(t).trim().toLowerCase();
  // Keep digits, separators and spaces; drop other letters/symbols
  s = s.replace(/[^0-9.,\s]/g, "");
  // Collapse spaces between digits: "1 2" → "12"
  s = s.replace(/(?<=\d)\s+(?=\d)/g, "");
  // Find first number with optional decimal using comma or dot
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const numStr = m[1].replace(",", ".");
  const val = Number(numStr);
  return Number.isFinite(val) ? val : null;
}

// Format quantities to at most one decimal for user-friendly messages
function fmtQty(n: number): string {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
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

// ===== Attendant day lock helpers (soft lock in Setting) =====
const dayLockKey = (date: string, outlet: string) => `lock:attendant:${date}:${outlet}`;

async function isDayLocked(date: string, outlet: string): Promise<boolean> {
  const lock = await (prisma as any).setting.findUnique({ where: { key: dayLockKey(date, outlet) } }).catch(() => null);
  return Boolean(lock?.value?.locked);
}

async function lockDay(date: string, outlet: string, actorCode?: string) {
  const key = dayLockKey(date, outlet);
  const value = { locked: true, lockedAt: new Date().toISOString(), by: actorCode || "wa" };
  await (prisma as any).setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

// Fetch items already closed for this date/outlet
async function getClosedKeys(date: string, outlet: string): Promise<Set<string>> {
  const rows = await (prisma as any).attendantClosing.findMany({ where: { date, outletName: outlet }, select: { itemKey: true } });
  return new Set<string>((rows || []).map((r: any) => r.itemKey));
}

function looksLikeCode(t: string) {
  return /^[A-Za-z0-9]{3,10}$/.test(String(t || "").trim());
}

async function notifySupAdm(message: string) {
  try {
    const [sup, adm] = await Promise.all([
      (prisma as any).phoneMapping.findMany({ where: { role: "supervisor", phoneE164: { not: "" } }, select: { phoneE164: true } }),
      (prisma as any).phoneMapping.findMany({ where: { role: "admin", phoneE164: { not: "" } }, select: { phoneE164: true } }),
    ]);
    const list = [...sup, ...adm].map((r: any) => r.phoneE164).filter(Boolean) as string[];
    if (!list.length) return;
    await Promise.allSettled(list.map((to) => sendText(to, message, "AI_DISPATCH_TEXT", { gpt_sent: true })));
  } catch (e) {
    console.warn("notifySupAdm failed", e);
  }
}

export async function sendAttendantMenu(phone: string, sess: any, opts?: { force?: boolean; source?: string }) {
  const phoneE164 = phone.startsWith("+") ? phone : "+" + phone;
  // Track whether this function acquired the in-flight lock so we only release
  // it when appropriate. Callers like safeSendGreetingOrMenu may already hold the lock
  // and call this with force=true.
  let acquiredHere = false;
  if (!opts?.force) {
    // pre-check quickly before attempting to acquire in-flight lock
    const allowed = await menuSendAllowed(phoneE164);
    if (!allowed) {
      try { console.info?.(`[wa] skip attendant menu`, { phoneE164, source: opts?.source }); } catch {}
      return;
    }
    // Attempt to acquire in-flight lock. If we fail, another send is running on this instance.
    if (!acquireInFlight(phoneE164)) {
      try { console.info?.(`[wa] skip attendant menu (concurrent in-flight)`, { phoneE164, source: opts?.source }); } catch {}
      return;
    }
    acquiredHere = true;
  } else {
    // force: caller may have already acquired the lock. Only acquire if not held.
    if (!MENU_IN_FLIGHT.has(phoneE164)) {
      if (!acquireInFlight(phoneE164)) {
        try { console.info?.(`[wa] force skip attendant menu (concurrent in-flight)`, { phoneE164, source: opts?.source }); } catch {}
        return;
      }
      acquiredHere = true;
    }
  }

  const outlet = sess?.outlet || undefined;
  const header = outlet ? `You're logged in as an attendant at ${outlet}.` : "You're logged in as an attendant.";
  await sendText(phone, `${header} What would you like to do?`, "AI_DISPATCH_TEXT", { gpt_sent: true });

  const rows = [
    { id: "ATT_CLOSING", title: "Enter Closing", description: "Record today's closing quantities" },
    { id: "ATT_DEPOSIT", title: "Deposit", description: "Record till deposit (paste SMS)" },
    { id: "ATT_EXPENSE", title: "Expense", description: "Capture outlet expenses" },
    { id: "MENU_SUMMARY", title: "Summary", description: "Review today's snapshot" },
    { id: "MENU_TXNS", title: "Till Count", description: "See today's till payments" },
    { id: "MENU_SUPPLY", title: "Supply", description: "Check opening stock & deliveries" },
    { id: "LOGOUT", title: "Logout", description: "End session and re-login" },
  ];

  const payload = buildListPayload(phone.replace(/^\+/, ""), {
    type: "list",
    header: { type: "text", text: "Choose an action" },
    body: { text: "Pick one option below." },
    footer: { text: "Need something else? Reply HELP." },
    action: {
      button: "Menu",
      sections: [{ title: "Attendant menu", rows }],
    },
  });
  await sendInteractive(payload as any, "AI_DISPATCH_INTERACTIVE");
  try {
    try { await logOutbound({ direction: "out", templateName: null, payload: { phoneE164: phoneE164, source: opts?.source, kind: 'interactive_menu' }, status: 'SENT', type: 'MENU_SEND' }); } catch {}
    await markMenuSent(phoneE164, opts?.source);
  } finally {
    if (acquiredHere) releaseInFlight(phoneE164);
  }
}

async function getAvailableClosingProducts(sess: any, cursor: Cursor) {
  const prodsAll = await getAssignedProducts(sess.code || "");
  if (!sess.outlet) return prodsAll;
  const closed = await getClosedKeys(cursor.date, sess.outlet);
  // If opening stock exists for the day, only allow those products (dashboard parity)
  let openingKeys = new Set<string>();
  try {
    const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName: sess.outlet, date: cursor.date }, select: { itemKey: true } });
    openingKeys = new Set<string>((rows || []).map((r: any) => r.itemKey).filter(Boolean));
  } catch {}
  const restrictByOpening = openingKeys.size > 0;
  return prodsAll.filter((p) => !closed.has(p.key) && (!restrictByOpening || openingKeys.has(p.key)));
}

async function promptLogin(phone: string) {
  // Generate a per-phone login link that carries wa + nonce
  const urlObj = await createLoginLink(toDbPhone(phone));
  await sendText(
    phone,
    `You're not logged in. Tap this link to log in via the website:\n${urlObj.url}\nAfter verifying your code, we'll greet you here.`,
    "AI_DISPATCH_TEXT",
    { gpt_sent: true }
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
  } as any, "AI_DISPATCH_INTERACTIVE");
}

// --- Menu send guard helpers: prevent duplicate menu/greeting sends within short window ---
// In-process lock to avoid concurrent sends from the same instance
const MENU_IN_FLIGHT = new Set<string>();

function acquireInFlight(phoneE164: string) {
  if (MENU_IN_FLIGHT.has(phoneE164)) return false;
  MENU_IN_FLIGHT.add(phoneE164);
  return true;
}

function releaseInFlight(phoneE164: string) {
  MENU_IN_FLIGHT.delete(phoneE164);
}

export async function menuSendAllowed(phoneE164: string, minIntervalMs = 8_000) {
  try {
    // If another send is in-flight on this instance, suppress
    if (MENU_IN_FLIGHT.has(phoneE164)) {
      try { console.info?.(`[wa] menu suppressed (in-flight)`, { phoneE164, minIntervalMs }); } catch {}
      return false;
    }
    const st = await getWaState(phoneE164);
    const last = st?.lastMenuSentAt ? new Date(st.lastMenuSentAt).getTime() : 0;
    const allowed = Date.now() - last > minIntervalMs; // allow if more than the threshold since last menu
    if (!allowed) {
      try { console.info?.(`[wa] menu suppressed`, { phoneE164, lastSentAt: st?.lastMenuSentAt, minIntervalMs }); } catch {}
    }
    return allowed;
  } catch (e) {
    return true;
  }
}

export async function markMenuSent(phoneE164: string, source?: string) {
  try {
    const now = new Date().toISOString();
    await updateWaState(phoneE164, { lastMenuSentAt: now, lastMessageAt: now });
    try { console.info?.(`[wa] menu marked`, { phoneE164, source, timestamp: now }); } catch {}
  } catch (e) {
    // best-effort
  }
}

type GreetingParams = {
  phone: string;
  role?: string | null;
  outlet?: string | null;
  force?: boolean;
  source?: string;
  sessionLike?: any;
};

export async function safeSendGreetingOrMenu({
  phone,
  role,
  outlet,
  force = false,
  source,
  sessionLike,
}: GreetingParams): Promise<boolean> {
  const phoneE164 = phone.startsWith("+") ? phone : "+" + phone;
  const roleKey = String(role || "attendant");
  const roleKind = roleKey.toLowerCase();
  // Quick pre-check
  const preAllowed = force || (await menuSendAllowed(phoneE164));
  if (!preAllowed) {
    try { console.info?.(`[wa] greeting suppressed (pre-check)`, { phoneE164, role: roleKind, outlet, source }); } catch {}
    try { await logOutbound({ direction: 'in', templateName: null, payload: { phoneE164, source, reason: 'pre-check' }, status: 'INFO', type: 'GREETING_SUPPRESSED' }); } catch {}
    return false;
  }

  // Acquire in-flight lock to avoid concurrent sends from this instance
  if (!acquireInFlight(phoneE164)) {
    try { console.info?.(`[wa] greeting suppressed (in-flight)`, { phoneE164, role: roleKind, outlet, source }); } catch {}
    try { await logOutbound({ direction: 'in', templateName: null, payload: { phoneE164, source, reason: 'in-flight' }, status: 'INFO', type: 'GREETING_SUPPRESSED' }); } catch {}
    return false;
  }

  try {
    // Re-check DB state to avoid race condition with another process
    const allowed = force || (await menuSendAllowed(phoneE164));
    if (!allowed) {
      try { console.info?.(`[wa] greeting suppressed (re-check)`, { phoneE164, role: roleKind, outlet, source }); } catch {}
      try { await logOutbound({ direction: 'in', templateName: null, payload: { phoneE164, source, reason: 're-check' }, status: 'INFO', type: 'GREETING_SUPPRESSED' }); } catch {}
      return false;
    }

    // Cross-process guard: try to create a short-lived reminderSend entry (5s window).
    // reminderSend has a unique constraint on (type, phoneE164, date), so concurrent
    // attempts with the same windowKey will fail for all but one process.
    // In test or when DB is unavailable, proceed without suppressing to keep unit tests deterministic.
    const windowKey = String(Math.floor(Date.now() / 5000));
    try {
      await (prisma as any).reminderSend.create({ data: { type: `menu_send_v1`, phoneE164: phoneE164, date: windowKey } });
    } catch (err: any) {
      const msg = String(err?.message || err || "");
      const code = (err && (err as any).code) || "";
      const isUnique = code === "P2002" || /unique constraint/i.test(msg);
      const isDbMissing = /Environment variable not found: DATABASE_URL/i.test(msg);
      const isTest = String(process.env.NODE_ENV || "").toLowerCase() === "test";
      if (isUnique) {
        // When the caller explicitly forces (e.g., user typed MENU/1), bypass the
        // duplicate suppression and proceed to send a fresh menu immediately.
        if (force) {
          try { console.info?.(`[wa] reminderSend dup overridden by force`, { phoneE164, windowKey, source }); } catch {}
        } else {
          try { console.info?.(`[wa] greeting suppressed (reminderSend dup)`, { phoneE164, windowKey, source }); } catch {}
          try { await logOutbound({ direction: 'in', templateName: null, payload: { phoneE164, source, reason: 'reminderSend dup', windowKey }, status: 'INFO', type: 'GREETING_SUPPRESSED' }); } catch {}
          return false;
        }
      }
      // For test runs or missing DB, log and proceed (do not suppress)
      try { console.info?.(`[wa] reminderSend guard disabled`, { phoneE164, windowKey, source, code, reason: isDbMissing ? 'db_missing' : 'unknown_error' }); } catch {}
    }

    if (roleKind === "attendant") {
      const sess = sessionLike || { outlet: outlet ?? undefined };
      await sendAttendantMenu(phoneE164, sess, { force: true, source });
    } else {
      const roleLabel = roleKind.charAt(0).toUpperCase() + roleKind.slice(1);
      const outletText = outlet ? ` at ${outlet}` : "";
      await sendText(phoneE164, `You're logged in as a ${roleLabel}${outletText}. Reply MENU for options.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      try { await logOutbound({ direction: "out", templateName: null, payload: { phoneE164: phoneE164, source, kind: 'text_greeting' }, status: 'SENT', type: 'MENU_SEND' }); } catch {}
      await markMenuSent(phoneE164, source);
    }

    try { console.info?.(`[wa] greeting sent`, { phoneE164, role: roleKind, outlet, source }); } catch {}
    return true;
  } finally {
    releaseInFlight(phoneE164);
  }
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
  await sendText(phoneE164.replace(/^[+]/, ""), "Your outlet is not set. Ask Supervisor to assign your outlet.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return true;
    }
  }

  // Enter MENU and send menu
  const tradingDate = today();
  await (prisma as any).waSession.upsert({
    where: { phoneE164 },
    update: { code: pc.code, role: finalRole, outlet, state: "MENU", cursor: { date: tradingDate, rows: [] } },
    create: { phoneE164, code: pc.code, role: finalRole, outlet, state: "MENU", cursor: { date: tradingDate, rows: [] } },
  });

  await updateWaState(phoneE164, {
    waId: phoneE164,
    attendantCode: pc.code,
    outletName: outlet ?? undefined,
    currentAction: "menu",
    closingDraft: undefined,
    lastMessageAt: new Date().toISOString(),
  });

  await safeSendGreetingOrMenu({
    phone: phoneE164,
    role: finalRole,
    outlet,
    source: "bind_enter_menu",
  });
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
    // Menu/greeting already handled via bindPhoneAndEnterMenu; avoid duplicate text.
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
  // Defensive: normalize rows and date
  if (!Array.isArray(cur.rows)) cur.rows = [] as any;
  if (!cur.date) cur.date = today();

  // If we're in umbrella CLOSING state but have an active currentItem, coerce to CLOSING_QTY
  // so that numeric input is processed instead of falling back to default help.
  try {
    const st = String(s.state || '').toUpperCase();
    const hasItem = !!(cur && (cur as any).currentItem && typeof (cur as any).currentItem.key === 'string');
    if (st === 'CLOSING' && hasItem) {
      // Persist the more specific state for subsequent messages
      await saveSession(phone, { state: 'CLOSING_QTY', ...cur });
      s.state = 'CLOSING_QTY' as any;
      try { await logOutbound({ direction: 'in', templateName: null, payload: { phone: phone, event: 'closing.state.coerce', from: st, to: 'CLOSING_QTY' }, status: 'INFO', type: 'CLOSING_STATE_COERCE' }); } catch {}
    }
  } catch {}

  // Try one-tap link login first
  const phoneE164 = phone.startsWith("+") ? phone : "+" + phone;
  const auto = await tryAutoLinkLogin(t, phoneE164);
  if (auto) return;

  // Inactivity reset
  if (inactiveExpired(s.updatedAt)) {
    if (s.code && s.outlet) {
      await saveSession(phone, { state: "MENU", date: today(), rows: [] });
      await safeSendGreetingOrMenu({
        phone,
        role: s.role || "attendant",
        outlet: s.outlet,
        source: "inactivity_resume",
      });
    } else {
      await saveSession(phone, { state: "LOGIN", date: today(), rows: [] });
      await promptLogin(phone);
    }
    return;
  }

  // Global commands
  // Quick start dispute wizard: reply "1" to list today's items and pick by number or name
  if (/^1$/.test(t) && s.outlet) {
    const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName: s.outlet, date: cur.date }, orderBy: { id: "asc" } });
    if (!rows.length) {
      await sendText(phone, `No opening items recorded yet for ${s.outlet} (${cur.date}).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    } else {
      const lines = rows.map((r: any, i: number) => `${i + 1}) ${r.itemKey} (${Number(r.qty || 0)}${r.unit || ''})`).slice(0, 40);
      const more = rows.length > lines.length ? `\n(+${rows.length - lines.length} more)` : '';
      await sendText(phone, `Which item do you want to dispute? Reply with the number OR type the product name (e.g., GOAT).\n${lines.join("\n")}${more}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      (cur as any).disputePickMode = true;
      await saveSession(phone, { state: s.state, ...cur });
    }
    return;
  }
  // If in "pick mode", accept a number and jump into existing DISPUTE flow
  if ((cur as any).disputePickMode && /^\d{1,3}$/.test(t) && s.outlet) {
    const index = Number(t);
    const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName: s.outlet, date: cur.date }, orderBy: { id: "asc" } });
    if (!rows.length) {
      await sendText(phone, `No opening items yet for ${s.outlet} (${cur.date}).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      delete (cur as any).disputePickMode;
      await saveSession(phone, { state: "MENU", ...cur });
      return;
    }
    if (!(index >= 1 && index <= rows.length)) {
      await sendText(phone, `Invalid item number. Send LIST to view indices.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    const row = rows[index - 1];
    (cur as any).disputeDraft = {
      rowId: row.id,
      itemKey: row.itemKey,
      name: row.itemKey,
      recordedQty: Number(row.qty || 0),
      unit: row.unit || 'kg',
      index,
    };
    delete (cur as any).disputePickMode;
    await saveSession(phone, { state: "DISPUTE_QTY", ...cur });
    await sendText(phone, `Please enter the expected quantity for ${row.itemKey}. Delivered was ${row.qty}${row.unit || ''}. Enter a number (e.g., 12.0) or X to cancel.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    return;
  }
  if ((cur as any).disputePickMode && !/^\d{1,3}$/.test(t) && s.outlet) {
    const queryText = t.trim().toLowerCase();
    const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName: s.outlet, date: cur.date }, orderBy: { id: "asc" } });
    if (!rows.length) {
      await sendText(phone, `No opening items yet for ${s.outlet} (${cur.date}).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      delete (cur as any).disputePickMode;
      await saveSession(phone, { state: "MENU", ...cur });
      return;
    }
    const itemKeys: string[] = rows.map((r: any) => String(r.itemKey));
    let nameByKey = new Map<string, string>();
    try {
      const prods = await (prisma as any).product.findMany({ where: { key: { in: itemKeys } }, select: { key: true, name: true } });
      for (const p of prods || []) nameByKey.set(String(p.key), String(p.name || ''));
    } catch {}
    // Build candidates with both key and product name for case-insensitive match
    type Cand = { index: number; key: string; disp: string };
    const cands: Cand[] = rows.map((r: any, i: number) => ({ index: i + 1, key: String(r.itemKey), disp: nameByKey.get(String(r.itemKey)) || String(r.itemKey) }));
    const norm = (s: string) => s.trim().toLowerCase();
    const byExact = cands.filter(c => norm(c.disp) === queryText || norm(c.key) === queryText);
    const byPrefix = byExact.length ? byExact : cands.filter(c => norm(c.disp).startsWith(queryText) || norm(c.key).startsWith(queryText));
    const byIncludes = byPrefix.length ? byPrefix : cands.filter(c => norm(c.disp).includes(queryText) || norm(c.key).includes(queryText));
    const matches = byIncludes;
    if (matches.length === 1) {
      const m = matches[0];
      const row = rows[m.index - 1];
      (cur as any).disputeDraft = {
        rowId: row.id,
        itemKey: row.itemKey,
        name: nameByKey.get(String(row.itemKey)) || row.itemKey,
        recordedQty: Number(row.qty || 0),
        unit: row.unit || 'kg',
        index: m.index,
      };
      delete (cur as any).disputePickMode;
      await saveSession(phone, { state: "DISPUTE_QTY", ...cur });
      await sendText(phone, `Please enter the expected quantity for ${nameByKey.get(String(row.itemKey)) || row.itemKey}. Delivered was ${row.qty}${row.unit || ''}. Enter a number (e.g., 12.0) or X to cancel.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    if (matches.length > 1) {
      const lines = matches.slice(0, 10).map(m => `${m.index}) ${cands[m.index-1].disp}`);
      const suffix = matches.length > 10 ? `\n(+${matches.length - 10} more)` : '';
      await sendText(phone, `I found multiple matches. Reply with the number:\n${lines.join('\n')}${suffix}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    // No matches
    const lines = rows.map((r: any, i: number) => `${i + 1}) ${nameByKey.get(String(r.itemKey)) || r.itemKey}`).slice(0, 20);
    await sendText(phone, `I couldn't find "${t}". Reply with the number, or type the product name as shown.\n${lines.join('\n')}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    return;
  }
  // Supply opening LIST command (show today's opening items with indices)
  if (/^LIST$/i.test(t) && s.outlet) {
    const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName: s.outlet, date: cur.date }, orderBy: { id: "asc" } });
    if (!rows.length) {
      await sendText(phone, `No opening items recorded yet for ${s.outlet} (${cur.date}).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    } else {
      const lines = rows.map((r: any, i: number) => `${i + 1}. ${r.itemKey} ${Number(r.qty || 0)}${r.unit || ''}`).slice(0, 40);
      const more = rows.length > lines.length ? `\n(+${rows.length - lines.length} more)` : '';
      await sendText(phone, `Opening items ${s.outlet} (${cur.date}):\n${lines.join("\n")}${more}\nReply D<number> to dispute (e.g. D3).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
    return;
  }
  // Start per-item dispute: D<number> or DISPUTE <number>
  const dItemMatch = t.match(/^D(\d{1,3})$/i) || t.match(/^DISPUTE\s+(\d{1,3})$/i);
  if (dItemMatch && s.code && s.outlet) {
    const index = Number(dItemMatch[1]);
    const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName: s.outlet, date: cur.date }, orderBy: { id: "asc" } });
    if (!rows.length) {
      await sendText(phone, `No opening items yet for ${s.outlet} (${cur.date}).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    if (!(index >= 1 && index <= rows.length)) {
      await sendText(phone, `Invalid item number. Send LIST to view indices.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    const row = rows[index - 1];
    // Check existing pending dispute for this row
    try {
      const existing = await (prisma as any).reviewItem.findFirst({ where: { type: { in: ["supply_dispute", "supply_dispute_item"] as any }, status: "pending" }, orderBy: { createdAt: "desc" } });
      // (Light heuristic) We don't embed rowId in reviewItem schema directly; payload search would require JSON filter (skip for simplicity)
      if (existing && String((existing.payload as any)?.rowId || '') === String(row.id)) {
        await sendText(phone, `A dispute for ${row.itemKey} is already pending. Supervisor will review.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
        return;
      }
    } catch {}
    (cur as any).disputeDraft = {
      rowId: row.id,
      itemKey: row.itemKey,
      name: row.itemKey,
      recordedQty: Number(row.qty || 0),
      unit: row.unit || 'kg',
      index,
    };
    await saveSession(phone, { state: "DISPUTE_QTY", ...cur });
    await sendText(phone, `Dispute item ${index}: ${row.itemKey} recorded ${row.qty}${row.unit || ''}. Enter actual quantity (numbers only) or X to cancel.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    return;
  }

  // Dispute flow states
  if (s.state === 'DISPUTE_QTY') {
    if (/^(X|CANCEL|NO)$/i.test(t)) {
      delete (cur as any).disputeDraft;
      await saveSession(phone, { state: "MENU", ...cur });
      await sendText(phone, "Dispute cancelled.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      await safeSendGreetingOrMenu({ phone, role: s.role || 'attendant', outlet: s.outlet, force: true, source: 'dispute_cancel', sessionLike: s });
      return;
    }
    if (!/^\d+(?:\.\d+)?$/.test(t)) {
      await sendText(phone, "Numbers only, e.g. 10 or 10.5 (or X to cancel).", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    const q = Number(t);
    const draft = (cur as any).disputeDraft;
    if (!draft) {
      await saveSession(phone, { state: "MENU", ...cur });
      await sendText(phone, "No active dispute. Send LIST then D<number> to start.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    // Basic sanity: claim cannot exceed 5x recorded to catch mistakes
    if (draft.recordedQty && q > draft.recordedQty * 5) {
      await sendText(phone, `That seems too large. Enter a value <= ${draft.recordedQty * 5} or X to cancel.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    draft.claimedQty = q;
    await saveSession(phone, { state: 'DISPUTE_REASON', ...cur });
    await sendText(phone, `Reason? Reply 1 Short 2 Wrong 3 Quality 4 Other. (X to cancel)`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    return;
  }
  if (s.state === 'DISPUTE_REASON') {
    if (/^(X|CANCEL|NO)$/i.test(t)) {
      delete (cur as any).disputeDraft;
      await saveSession(phone, { state: "MENU", ...cur });
      await sendText(phone, "Dispute cancelled.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      await safeSendGreetingOrMenu({ phone, role: s.role || 'attendant', outlet: s.outlet, force: true, source: 'dispute_cancel_reason', sessionLike: s });
      return;
    }
    const draft = (cur as any).disputeDraft;
    if (!draft) {
      await saveSession(phone, { state: "MENU", ...cur });
      await sendText(phone, "No active dispute. Send LIST then D<number> to start.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    if (!/^[1-4]$/.test(t)) {
      await sendText(phone, "Reply 1,2,3 or 4 (X to cancel).", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    const code = Number(t);
    draft.reasonCode = code;
    draft.reasonText = ({1:'Short weight',2:'Wrong product',3:'Quality issue',4:'Other'} as any)[code];
    if (code === 4) {
      await saveSession(phone, { state: 'DISPUTE_REASON_TEXT', ...cur });
      await sendText(phone, 'Enter short reason text (under 80 chars).', 'AI_DISPATCH_TEXT', { gpt_sent: true });
      return;
    }
    await saveSession(phone, { state: 'DISPUTE_CONFIRM', ...cur });
    await sendText(phone, disputeConfirmText(draft), 'AI_DISPATCH_TEXT', { gpt_sent: true });
    return;
  }
  if (s.state === 'DISPUTE_REASON_TEXT') {
    if (/^(X|CANCEL|NO)$/i.test(t)) {
      delete (cur as any).disputeDraft;
      await saveSession(phone, { state: "MENU", ...cur });
      await sendText(phone, "Dispute cancelled.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      await safeSendGreetingOrMenu({ phone, role: s.role || 'attendant', outlet: s.outlet, force: true, source: 'dispute_cancel_other', sessionLike: s });
      return;
    }
    const draft = (cur as any).disputeDraft;
    if (!draft) {
      await saveSession(phone, { state: "MENU", ...cur });
      await sendText(phone, "No active dispute. Send LIST then D<number> to start.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    draft.reasonText = t.slice(0, 80);
    await saveSession(phone, { state: 'DISPUTE_CONFIRM', ...cur });
    await sendText(phone, disputeConfirmText(draft), 'AI_DISPATCH_TEXT', { gpt_sent: true });
    return;
  }
  if (s.state === 'DISPUTE_CONFIRM') {
    const draft = (cur as any).disputeDraft;
    if (/^(NO|N|X|CANCEL)$/i.test(t)) {
      delete (cur as any).disputeDraft;
      await saveSession(phone, { state: 'MENU', ...cur });
      await sendText(phone, 'Dispute cancelled.', 'AI_DISPATCH_TEXT', { gpt_sent: true });
      await safeSendGreetingOrMenu({ phone, role: s.role || 'attendant', outlet: s.outlet, force: true, source: 'dispute_cancel_confirm', sessionLike: s });
      return;
    }
    if (/^(YES|Y)$/i.test(t)) {
      if (!draft || !s.outlet || !s.code) {
        await saveSession(phone, { state: 'MENU', ...cur });
        await sendText(phone, 'Missing dispute context.', 'AI_DISPATCH_TEXT', { gpt_sent: true });
        return;
      }
      // Persist review item
      try {
        await createReviewItem({ type: 'supply_dispute_item', outlet: s.outlet, date: new Date(), payload: {
          rowId: draft.rowId,
          itemKey: draft.itemKey,
            recordedQty: draft.recordedQty,
            claimedQty: draft.claimedQty,
            unit: draft.unit,
            reasonCode: draft.reasonCode,
            reasonText: draft.reasonText,
            date: cur.date,
            outlet: s.outlet,
            attendantCode: s.code,
        } });
        await notifySupAdm(`[DISPUTE] ${s.outlet} ${cur.date} ${draft.itemKey}: recorded ${draft.recordedQty}${draft.unit} vs claimed ${draft.claimedQty}${draft.unit} (${draft.reasonText}).`);
        await sendText(phone, `Dispute submitted. Ref saved for ${draft.itemKey}. Supervisor notified.`, 'AI_DISPATCH_TEXT', { gpt_sent: true });
      } catch (e) {
        await sendText(phone, 'Failed to submit dispute. Try again later.', 'AI_DISPATCH_TEXT', { gpt_sent: true });
      }
      delete (cur as any).disputeDraft;
      await saveSession(phone, { state: 'MENU', ...cur });
      await safeSendGreetingOrMenu({ phone, role: s.role || 'attendant', outlet: s.outlet, force: true, source: 'dispute_submitted', sessionLike: s });
      return;
    }
    await sendText(phone, 'Reply YES to submit or NO to cancel.', 'AI_DISPATCH_TEXT', { gpt_sent: true });
    return;
  }

  if (/^(HELP)$/i.test(t)) {
    if (!s.code) {
      await sendText(phone, "You're not logged in. Use the login link we sent above to continue.", "AI_DISPATCH_TEXT", { gpt_sent: true });
    } else {
      await sendText(phone, "HELP: MENU, TXNS, LOGOUT. During entry: numbers only (e.g., 9.5). Paste M-Pesa SMS to record deposit.", "AI_DISPATCH_TEXT", { gpt_sent: true });
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
    // Send a single consolidated logout message with the login link
    try {
      const urlObj = await createLoginLink(toDbPhone(phone));
      await sendText(
        phone,
        `You've been logged out. Tap this link to log in via the website:\n${urlObj.url}`,
        "AI_DISPATCH_TEXT",
        { gpt_sent: true }
      );
    } catch {
      // Fallback: minimal text if link generation fails
      await sendText(phone, "You've been logged out.", "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
    return;
  }
  const disputeMatch = t.match(/^DISPUTE\b(?:\s+(.*))?$/i);
  if (disputeMatch) {
    if (!s.code || !s.outlet) {
      await sendText(phone, "You need to be linked to an outlet before raising a dispute. Ask your supervisor.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    const reason = (disputeMatch[1] || '').trim();
    if (!reason) {
      await sendText(phone, "Please include a reason after DISPUTE. Example: DISPUTE wrong weight on beef.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    try {
      await handleSupplyDispute({
        outletName: s.outlet,
        date: cur.date || today(),
        reason,
        attendantPhone: phone.startsWith('+') ? phone : `+${phone}`,
        attendantCode: s.code || null,
      });
    } catch (err) {
      console.error('supply dispute failed', err);
      await sendText(phone, "We couldn't record the dispute. Please contact your supervisor directly.", "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
    return;
  }
  if (/^(TXNS)$/i.test(t)) {
    if (!s.code || !s.outlet) {
  await sendText(phone, "Login first (send your code).", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    const rows = await (prisma as any).attendantDeposit.findMany({
      where: { outletName: s.outlet, date: cur.date },
      take: 10,
      orderBy: { createdAt: "desc" },
    });
    if (!rows.length) {
      await sendText(phone, "No deposits yet today.", "AI_DISPATCH_TEXT", { gpt_sent: true });
    } else {
      const lines = rows.map((r: any) => {
        const note = r.note ? ` ref ${r.note}` : "";
        return `- ${r.amount} (${r.status})${note}`;
      });
      await sendText(phone, lines.join("\n"), "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
    return;
  }

  // SPLASH -> LOGIN
  if (s.state === "SPLASH") {
    await promptLogin(phone);
    await saveSession(phone, { state: "LOGIN" });
    return;
  }

  if (s.state === "LOGIN") {
    // Do not accept codes in chat. Always send a login link to finalize on the website.
    await sendText(phone, "We no longer accept codes in chat. Use the login link to continue.", "AI_DISPATCH_TEXT", { gpt_sent: true });
    await promptLogin(phone);
    return;
  }

  // MENU context
  const menuRequested = /^MENU$/i.test(t);
  if (menuRequested || s.state === "MENU") {
    if (!s.code || !s.outlet) {
      await sendText(phone, "You're not logged in. Send your login code (e.g., BR1234).", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    await safeSendGreetingOrMenu({
      phone,
      role: s.role || "attendant",
      outlet: s.outlet,
      force: menuRequested,
      source: menuRequested ? "menu_command" : "menu_state",
      sessionLike: s,
    });
    return;
  }

  // CLOSING_QTY numeric gate
  if (s.state === "CLOSING_QTY") {
    const parsed = isNumericText(t) ? Number(t) : parseNumericLoose(t);
    if (parsed !== null) {
      const val = parsed;
      const item = cur.currentItem;
        if (!item) {
        await sendText(phone, "Pick a product first.", "AI_DISPATCH_TEXT", { gpt_sent: true });
        return;
      }
      // Guard: day-level lock
      if (s.outlet && (await isDayLocked(cur.date, s.outlet))) {
        await sendText(phone, `Day is locked for ${s.outlet} (${cur.date}). Contact Supervisor.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
        await saveSession(phone, { state: "MENU", ...cur });
        await safeSendGreetingOrMenu({
          phone,
          role: s.role || "attendant",
          outlet: s.outlet,
          force: true,
          source: "day_locked_guard",
          sessionLike: s,
        });
        return;
      }
      // Guard: product already closed today
      if (s.outlet) {
        const closed = await getClosedKeys(cur.date, s.outlet);
        if (closed.has(item.key)) {
          await sendText(phone, `${item.name} is already closed for today. Pick another product.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
          await saveSession(phone, { state: "CLOSING_PICK", ...cur });
          const prods = await getAssignedProducts(s.code || "");
          const remaining = prods.filter((p) => !closed.has(p.key));
          await sendInteractive(listProducts(phone, remaining, s.outlet || "Outlet"), "AI_DISPATCH_INTERACTIVE");
          return;
        }
      }
      item.closing = val;
      await saveSession(phone, { state: "CLOSING_QTY", ...cur });

      const phoneE164 = phone.startsWith("+") ? phone : "+" + phone;
      const stateSnapshot = await getWaState(phoneE164);
      const existingDraft = stateSnapshot.closingDraft ?? { products: {}, orderedIds: [] };
      const draftProducts = { ...existingDraft.products };
      const draftOrdered = Array.from(new Set([...(existingDraft.orderedIds ?? []), item.key]));
      draftProducts[item.key] = {
        productKey: item.key,
        name: item.name,
        qty: val,
      };
      await updateWaState(phoneE164, {
        attendantCode: s.code ?? undefined,
        outletName: s.outlet ?? undefined,
        currentAction: "closing",
        closingDraft: {
          products: draftProducts,
          orderedIds: draftOrdered,
          selectedProductId: item.key,
          lastUpdated: new Date().toISOString(),
        },
        lastMessageAt: new Date().toISOString(),
      });

      await sendInteractive(buttonsWasteOrSkip(phone, item.name), "AI_DISPATCH_INTERACTIVE");
    } else {
      const itemName = cur.currentItem?.name || "this product";
      const promptText = `Enter a number for ${itemName} (you can include units), e.g. 12, 12.5 or 12kgs`;
      const payload = buildButtonPayload(phone.replace(/^\+/, ""), promptText, buildNavigationRow());
      await sendInteractive(payload as any, "AI_DISPATCH_INTERACTIVE");
    }
    return;
  }

  // CLOSING_WASTE_QTY numeric gate
  if (s.state === "CLOSING_WASTE_QTY") {
    const parsed = isNumericText(t) ? Number(t) : parseNumericLoose(t);
    if (parsed !== null) {
      const val = parsed;
      const item = cur.currentItem;
      if (!item) {
        await sendText(phone, "Pick a product first.", "AI_DISPATCH_TEXT", { gpt_sent: true });
        return;
      }
      // Guard: day-level lock
      if (s.outlet && (await isDayLocked(cur.date, s.outlet))) {
        await sendText(phone, `Day is locked for ${s.outlet} (${cur.date}). Contact Supervisor.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
        await saveSession(phone, { state: "MENU", ...cur });
        await safeSendGreetingOrMenu({
          phone,
          role: s.role || "attendant",
          outlet: s.outlet,
          force: true,
          source: "day_locked_guard_waste",
          sessionLike: s,
        });
        return;
      }
      item.waste = val;
      // If openEff is zero but user entered positive closing, auto-cap closing to 0 to keep flow moving
      try {
        if (s.outlet) {
          const openEff0 = await computeOpeningEffective(s.outlet, cur.date, item.key);
          const maxClosing0 = Math.max(0, openEff0 - Number(item.waste || 0));
          if (Number(item.closing || 0) > maxClosing0 && openEff0 === 0) {
            item.closing = 0;
            try { await sendText(phone, `No opening recorded for ${item.name} today. Closing auto-set to 0.`, "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
          }
        }
      } catch {}
      // Immediately persist single row and lock this product for the day
      if (s.outlet) {
        try {
          await saveClosings({
            date: cur.date,
            outletName: s.outlet,
            rows: [{ productKey: item.key, closingQty: item.closing || 0, wasteQty: item.waste || 0 }],
          });
          // Compute and send per-item sales summary before proceeding
          try {
            const [saved, pb] = await Promise.all([
              (prisma as any).attendantClosing.findUnique({ where: { date_outletName_itemKey: { date: cur.date, outletName: s.outlet, itemKey: item.key } } }),
              (prisma as any).pricebookRow.findFirst({ where: { outletName: s.outlet, productKey: item.key, active: true } }),
            ]);
            const openEff = await computeOpeningEffective(s.outlet, cur.date, item.key);
            // Always reflect what was persisted (handles auto-cap or server-side normalization)
            const closingQty = Number((saved?.closingQty ?? item.closing) || 0);
            const wasteQty = Number((saved?.wasteQty ?? item.waste) || 0);
            const soldUnits = Math.max(0, openEff - closingQty - wasteQty);
            const price = Number((pb as any)?.sellPrice || 0);
            const hasPrice = Number.isFinite(price) && price > 0;
            const value = soldUnits * (hasPrice ? price : 0);
            const pricePart = hasPrice ? ` @ KSh ${price.toLocaleString()}/kg` : "";
            const valuePart = hasPrice ? ` → Sales KSh ${Math.round(value).toLocaleString()}` : "";
            await sendText(
              phone,
              `${item.name}: Opening ${fmtQty(openEff)} − Closing ${fmtQty(closingQty)} − Waste ${fmtQty(wasteQty)} = Sold ${fmtQty(soldUnits)}${pricePart}${valuePart}`,
              "AI_DISPATCH_TEXT",
              { gpt_sent: true }
            );
          } catch {}
        } catch (e: any) {
          // If invalid (entered closing > opening-effective - waste), show specific guidance; else generic failure
          const code = (e && (e.code ?? (e as any).statusCode)) as any;
          if (code === 400) {
            try {
              const openEff = await computeOpeningEffective(s.outlet, cur.date, item.key);
              const maxClosing = Math.max(0, openEff - Number(item.waste || 0));
              await sendText(
                phone,
                `Invalid closing for ${item.name}. You entered ${fmtQty(item.closing ?? 0)} with waste ${fmtQty(item.waste ?? 0)}, but max allowed is ${fmtQty(maxClosing)}. Opening = yesterday closing + today supply = ${fmtQty(openEff)}. Re-enter a valid number.`,
                "AI_DISPATCH_TEXT",
                { gpt_sent: true }
              );
            } catch {}
          } else {
            try {
              await sendText(
                phone,
                `We couldn't save the closing for ${item.name} right now. Please try again in a moment.`,
                "AI_DISPATCH_TEXT",
                { gpt_sent: true }
              );
            } catch {}
          }
          // Keep state so attendant can retry entering waste/closing
          await saveSession(phone, { state: "CLOSING_QTY", ...cur });
          const promptText = buildQuantityPromptText(item.name);
          const navButtons = buildNavigationRow();
          const payload = buildButtonPayload(phone.replace(/^\+/, ""), promptText, navButtons);
          await sendInteractive(payload as any, "AI_DISPATCH_INTERACTIVE");
          return;
        }
      }
      upsertRow(cur, item.key, { name: item.name, closing: item.closing || 0, waste: item.waste || 0 });
      delete cur.currentItem;
      await nextPickOrSummary(phone, s, cur);
    } else {
      await sendText(phone, "Enter a number (units allowed), e.g. 0, 0.5 or 1kg", "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
    return;
  }

  // EXPENSE states
  if (s.state === "EXPENSE_NAME") {
    cur.expenseName = t;
    await saveSession(phone, { state: "EXPENSE_AMOUNT", ...cur });
    await sendText(phone, `Enter amount for ${t}. Numbers only, e.g. 250`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    return;
  }
  if (s.state === "EXPENSE_AMOUNT") {
    if (!isNumericText(t)) {
      await sendText(phone, "Numbers only, e.g. 250", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    const amount = Number(t);
      if (!s.outlet) {
  await sendText(phone, "No outlet bound. Ask supervisor.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return;
    }
    // Idempotent create: skip if identical expense exists
    const exists = await (prisma as any).attendantExpense.findFirst({ where: { date: cur.date, outletName: s.outlet, name: cur.expenseName || "Expense", amount } });
    if (!exists) {
      await (prisma as any).attendantExpense.create({ data: { date: cur.date, outletName: s.outlet, name: cur.expenseName || "Expense", amount } });
      // Notify supervisors/admins
      await notifySupAdm(`Expense recorded at ${s.outlet} (${cur.date}): ${cur.expenseName || "Expense"}  KSh ${amount}`);
    }
    await saveSession(phone, { state: "MENU", ...cur, expenseName: undefined });
    await sendInteractive(expenseFollowupButtons(phone), "AI_DISPATCH_INTERACTIVE");
    return;
  }

  // WAIT_DEPOSIT: parse M-Pesa
  if (s.state === "WAIT_DEPOSIT") {
    const parsed = parseMpesaText(t);
    if (parsed) {
      if (!s.outlet) {
        await sendText(phone, "No outlet bound. Ask supervisor.", "AI_DISPATCH_TEXT");
        return;
      }
  await addDeposit({ outletName: s.outlet, amount: parsed.amount, note: parsed.ref, date: cur.date, code: s.code || undefined });
  await notifySupAdm(`Deposit recorded at ${s.outlet} (${cur.date}): KSh ${parsed.amount} (ref ${parsed.ref}).`);
  await sendText(phone, `Deposit recorded: Ksh ${parsed.amount} (ref ${parsed.ref}). Send TXNS to view.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      await sendInteractive({
        messaging_product: "whatsapp",
        to: phone.replace(/^\+/, ""),
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: "Anything else?" },
          action: {
            buttons: [
              { type: "reply", reply: { id: "MENU_EXPENSE", title: "Add expense" } },
              { type: "reply", reply: { id: "MENU_SUMMARY", title: "View summary" } },
              { type: "reply", reply: { id: "MENU_TXNS", title: "View TXNS" } },
            ],
          },
        },
      } as any, "AI_DISPATCH_INTERACTIVE");
      return;
    }
    await sendText(phone, "Paste the original M-Pesa SMS (no edits).", "AI_DISPATCH_TEXT", { gpt_sent: true });
    return;
  }

  // Default: compact help
  if (!s.code) await sendText(phone, "You're not logged in. Use the login link to continue.", "AI_DISPATCH_TEXT", { gpt_sent: true });
  else await sendText(phone, "Try MENU or HELP.", "AI_DISPATCH_TEXT", { gpt_sent: true });
}

function disputeConfirmText(draft: any): string {
  return [
    'Confirm dispute:',
    `${draft.itemKey} recorded ${draft.recordedQty}${draft.unit} vs you say ${draft.claimedQty}${draft.unit}`,
    `Reason: ${draft.reasonText}`,
    'Reply YES to submit or NO to cancel.'
  ].join('\n');
}

export async function handleInteractiveReply(phone: string, payload: any): Promise<boolean> {
  const s = await loadSession(phone);
  if (s?.id) await touchSession(s.id);
  const cur: Cursor = (s.cursor as any) || { date: today(), rows: [] };
  // Defensive: ensure rows is always an array
  if (!Array.isArray(cur.rows)) cur.rows = [] as any;
  if (!cur.date) cur.date = today();
  const lr = payload?.list_reply?.id as string | undefined;
  const br = payload?.button_reply?.id as string | undefined;
  const id = lr || br || "";
  const phoneE164 = phone.startsWith("+") ? phone : "+" + phone;

  if (id === "NAV_MENU") {
    await saveSession(phone, { state: "MENU", ...cur });
    await updateWaState(phoneE164, { currentAction: "menu", closingDraft: undefined, lastMessageAt: new Date().toISOString() });
    await safeSendGreetingOrMenu({
      phone,
      role: s.role || "attendant",
      outlet: s.outlet,
      force: true,
      source: "nav_menu",
      sessionLike: s,
    });
    return true;
  }

  if (id === "NAV_CANCEL") {
    await saveSession(phone, { state: "MENU", ...cur, rows: [], currentItem: undefined });
    await updateWaState(phoneE164, { currentAction: "menu", closingDraft: undefined, lastMessageAt: new Date().toISOString() });
    await sendText(phone, "Closing draft cancelled.", "AI_DISPATCH_TEXT", { gpt_sent: true });
    await safeSendGreetingOrMenu({
      phone,
      role: s.role || "attendant",
      outlet: s.outlet,
      force: true,
      source: "nav_cancel",
      sessionLike: s,
    });
    return true;
  }

  if (id === "LOGOUT") {
    if (s?.id) {
      try {
        await (prisma as any).waSession.update({
          where: { id: s.id },
          data: { code: null, outlet: null, state: "LOGIN", cursor: {} as any },
        });
      } catch {}
      try { await sendText(phone, "You've been logged out.", "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
    }
    return true;
  }

  if (id === "NAV_BACK") {
    if (["CLOSING_QTY", "CLOSING_PICK", "SUMMARY", "CLOSING_WASTE_QTY"].includes(s.state)) {
      cur.currentItem = undefined;
      await saveSession(phone, { state: "CLOSING_PICK", ...cur });
      const available = await getAvailableClosingProducts(s, cur);
      if (!available.length) {
        await nextPickOrSummary(phone, s, cur);
      } else {
        // Include opening information per product in the description
        let openingMap = new Map<string, { qty: number; unit?: string }>();
        if (s.outlet) {
          try {
            const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName: s.outlet, date: cur.date } });
            for (const r of rows || []) openingMap.set(r.itemKey, { qty: Number(r.qty || 0), unit: r.unit || undefined });
          } catch {}
        }
        const options = available.slice(0, 10).map((p) => {
          const o = openingMap.get(p.key);
          const desc = o ? `Opening: ${o.qty}${o.unit ? ` ${o.unit}` : ""}` : "Opening: not set";
          return {
            id: `PROD_${p.key}`,
            title: p.name || p.key,
            description: desc,
          };
        });
        const interactive = buildProductPickerBody(options, available.length > 10 ? `Showing 10 of ${available.length}` : undefined);
        const payloadInteractive = buildListPayload(phone.replace(/^\+/, ""), interactive);
        await sendInteractive(payloadInteractive as any, "AI_DISPATCH_INTERACTIVE");
      }
      const stateSnapshot = await getWaState(phoneE164);
      const closingDraftPatch = stateSnapshot.closingDraft
        ? {
            products: stateSnapshot.closingDraft.products,
            orderedIds: stateSnapshot.closingDraft.orderedIds,
            selectedProductId: undefined,
            lastUpdated: new Date().toISOString(),
          }
        : undefined;
      const statePatch: Partial<WaState> = { currentAction: "closing", lastMessageAt: new Date().toISOString() };
      if (closingDraftPatch) statePatch.closingDraft = closingDraftPatch;
      await updateWaState(phoneE164, statePatch);
      return true;
    }
    await saveSession(phone, { state: "MENU", ...cur });
    await updateWaState(phoneE164, { currentAction: "menu", closingDraft: undefined, lastMessageAt: new Date().toISOString() });
    await safeSendGreetingOrMenu({
      phone,
      role: s.role || "attendant",
      outlet: s.outlet,
      force: true,
      source: "nav_back_menu",
      sessionLike: s,
    });
    return true;
  }
  // Quick path: show the extended list menu
  if (id === "MENU") {
    if (!s.code || !s.outlet) {
      await sendText(phone, "You're not logged in. Use the login link to continue.", "AI_DISPATCH_TEXT");
      await promptLogin(phone);
      return true;
    }
    await saveSession(phone, { state: "MENU", ...cur });
    await safeSendGreetingOrMenu({
      phone,
      role: s.role || "attendant",
      outlet: s.outlet,
      force: true,
      source: "interactive_menu_button",
      sessionLike: s,
    });
    return true;
  }

  // Login link resend handler
  if (id === "SEND_LOGIN_LINK") {
    const link = await createLoginLink(toDbPhone(phone));
    await sendText(phone, `Tap to log in via the website:\n${link.url}`, "AI_DISPATCH_TEXT");
    return true;
  }

  // Interpret menu choices
  if (id === "MENU_SUBMIT_CLOSING" || id === "ATD_CLOSING" || id === "ATT_CLOSING") {
    if (!s.code || !s.outlet) {
      await sendText(phone, "Login first (send your code).", "AI_DISPATCH_TEXT");
      return true;
    }
    if (await isDayLocked(cur.date, s.outlet)) {
      await sendText(phone, `Day is locked for ${s.outlet} (${cur.date}). Contact Supervisor.`, "AI_DISPATCH_TEXT");
      return true;
    }

    // Determine products to offer: if opening rows exist, restrict to them; else show assigned minus closed
    const assigned = await getAssignedProducts(s.code || "");
    const closed = await getClosedKeys(cur.date, s.outlet);
    let openingMap = new Map<string, { qty: number; unit?: string }>();
    try {
      const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName: s.outlet, date: cur.date } });
      for (const r of rows || []) openingMap.set(r.itemKey, { qty: Number(r.qty || 0), unit: r.unit || undefined });
    } catch {}
    const restrictByOpening = openingMap.size > 0;
    const prods = (assigned || []).filter((p: any) => !closed.has(p.key) && (!restrictByOpening || openingMap.has(p.key)));

    if (!restrictByOpening) {
      await sendText(
        phone,
        "No opening stock set for today. Listing your assigned products to record closing.",
        "AI_DISPATCH_TEXT",
      );
    }
    if (!prods.length) {
      if (restrictByOpening) {
        await sendText(phone, "Nothing left to close for today.", "AI_DISPATCH_TEXT");
        const nextButtons = buildClosingNextActionsButtons();
        const payload = buildButtonPayload(phone.replace(/^\+/, ""), "Next action?", nextButtons);
        await sendInteractive(payload as any, "AI_DISPATCH_INTERACTIVE");
      } else {
        await sendText(phone, "No products are assigned to your code. Ask your supervisor to assign products to you.", "AI_DISPATCH_TEXT");
      }
      return true;
    }

    await saveSession(phone, { state: "CLOSING_PICK", ...cur });

    const phoneE164 = phone.startsWith("+") ? phone : "+" + phone;
    const stateSnapshot = await getWaState(phoneE164);
    const draftProducts = { ...(stateSnapshot.closingDraft?.products ?? {}) };
    const orderedIds = [...(stateSnapshot.closingDraft?.orderedIds ?? [])];
    for (const row of cur.rows || []) {
      draftProducts[row.key] = { productKey: row.key, name: row.name, qty: Number(row.closing ?? 0) };
      if (!orderedIds.includes(row.key)) orderedIds.push(row.key);
    }

    await updateWaState(phoneE164, {
      attendantCode: s.code ?? undefined,
      outletName: s.outlet ?? undefined,
      currentAction: "closing",
      closingDraft: {
        products: draftProducts,
        orderedIds,
        selectedProductId: undefined,
        lastUpdated: new Date().toISOString(),
      },
      lastMessageAt: new Date().toISOString(),
    });

    const options = prods.slice(0, 10).map((p: any) => {
      const o = openingMap.get(p.key);
      const desc = o ? `Opening: ${o.qty}${o.unit ? ` ${o.unit}` : ""}` : "Opening: not set";
      return {
        id: `PROD_${p.key}`,
        title: p.name || p.key,
        description: desc,
      };
    });
    const interactive = buildProductPickerBody(options, prods.length > 10 ? `Showing 10 of ${prods.length}` : undefined);
    const payload = buildListPayload(phone.replace(/^\+/, ''), interactive);
    await sendInteractive(payload as any, "AI_DISPATCH_INTERACTIVE");
    return true;
  }
  if (id === "ATD_DEPOSIT" || id === "ATT_DEPOSIT" || id === "MENU_DEPOSIT") {
    await saveSession(phone, { state: "WAIT_DEPOSIT", ...cur });
    await sendText(phone, "Paste the original M-Pesa SMS (no edits). We will extract the amount and reference.", "AI_DISPATCH_TEXT");
    return true;
  }
  if (id === "MENU_EXPENSE" || id === "ATD_EXPENSE" || id === "ATT_EXPENSE") {
    await saveSession(phone, { state: "EXPENSE_NAME", ...cur });
    await sendInteractive(expenseNamePrompt(phone), "AI_DISPATCH_INTERACTIVE");
    return true;
  }
  if (id === "MENU_TXNS" || id === "ATD_TXNS") {
    const rows = await (prisma as any).attendantDeposit.findMany({ where: { outletName: s.outlet, date: cur.date }, take: 10, orderBy: { createdAt: "desc" } });
    if (!rows.length) {
      await sendText(phone, "No till payments recorded yet today.", "AI_DISPATCH_TEXT");
    } else {
      const lines = rows.map((r: any) => {
        const note = r.note ? ` ref ${r.note}` : "";
        return `- ${r.amount} (${r.status})${note}`;
      });
      await sendText(phone, lines.join("\n"), "AI_DISPATCH_TEXT");
    }
    return true;
  }

  if (id === "MENU_SUPPLY") {
    if (!s.outlet) {
      await sendText(phone, "No outlet bound. Ask supervisor.", "AI_DISPATCH_TEXT");
      return true;
    }
    // Show opening-effective (carry-forward): yesterday closing + today's deliveries
    // - Include all assigned products
    // - Sum yesterday's attendant closings per product
    // - Add today's delivery rows (SupplyOpeningRow)
    const assigned = await getAssignedProducts(s.code || "");
    const keys = assigned.map((p) => p.key);
    const y = prevDateISO(cur.date);
    const [prevClosings, todaySupply, prodRows] = await Promise.all([
      (prisma as any).attendantClosing.findMany({ where: { outletName: s.outlet, date: y } }).catch(() => []),
      (prisma as any).supplyOpeningRow.findMany({ where: { outletName: s.outlet, date: cur.date } }).catch(() => []),
      keys.length
        ? (prisma as any).product.findMany({ where: { key: { in: keys } }, select: { key: true, unit: true } }).catch(() => [])
        : [],
    ]);
    const unitByKey = new Map<string, string>();
    for (const p of prodRows as any[]) unitByKey.set(String(p.key), String(p.unit || "kg"));
    const openEff = new Map<string, number>();
    for (const r of (prevClosings as any[]) || []) {
      const k = String(r.itemKey || ""); if (!k) continue;
      const q = Number(r.closingQty || 0);
      openEff.set(k, (openEff.get(k) || 0) + (Number.isFinite(q) ? q : 0));
    }
    for (const r of (todaySupply as any[]) || []) {
      const k = String(r.itemKey || ""); if (!k) continue;
      const q = Number(r.qty || 0);
      openEff.set(k, (openEff.get(k) || 0) + (Number.isFinite(q) ? q : 0));
    }

    const lines = assigned.map((p) => {
      const qty = Number(openEff.get(p.key) || 0);
      const unit = (unitByKey.get(p.key) || "kg").trim();
      return `- ${p.name}: ${fmtQty(qty)} ${unit}`;
    });
    await sendText(
      phone,
      `Opening (carry-forward) for ${s.outlet} (${cur.date}):\n${lines.join("\n")}\n\nNote: Opening = yesterday closing + today deliveries.`,
      "AI_DISPATCH_TEXT"
    );

    // After syncing supply, suggest next action
    const remaining = await getAvailableClosingProducts(s, cur);
    if (remaining.length > 0) {
      const payload = buildButtonPayload(phone.replace(/^\+/, ""), "What would you like to do next?", buildClosingNextActionsButtons());
      await sendInteractive(payload as any, "AI_DISPATCH_INTERACTIVE");
    } else {
      await sendText(phone, "All assigned products have been closed for today.", "AI_DISPATCH_TEXT");
      const payload = buildButtonPayload(phone.replace(/^\+/, ""), "Next action?", buildClosingNextActionsButtons());
      await sendInteractive(payload as any, "AI_DISPATCH_INTERACTIVE");
    }
    return true;
  }

  if (id === "MENU_SUMMARY") {
    if (!s.outlet) {
      await sendText(phone, "No outlet bound. Ask supervisor.", "AI_DISPATCH_TEXT");
      return true;
    }
    try {
      const totals = await computeDayTotals({ date: cur.date, outletName: s.outlet });
      const lines = [
        `Summary for ${s.outlet} (${cur.date})`,
        `Expected sales: Ksh ${totals.expectedSales}`,
        `Expenses: Ksh ${totals.expenses}`,
        `Expected deposit: Ksh ${totals.expectedDeposit}`,
      ];
      await sendText(phone, lines.join("\n"), "AI_DISPATCH_TEXT");
    } catch (e) {
      await sendText(phone, "Summary is unavailable right now. Try again later.", "AI_DISPATCH_TEXT");
    }
    return true;
  }

  // List product selection
  if (id.startsWith("PROD_")) {
    const key = id.replace(/^PROD_/, "");
    // Guard: day-level lock
    if (s.outlet && (await isDayLocked(cur.date, s.outlet))) {
      await sendText(phone, `Day is locked for ${s.outlet} (${cur.date}). Contact Supervisor.`, "AI_DISPATCH_TEXT");
      await saveSession(phone, { state: "MENU", ...cur });
      try { await safeSendGreetingOrMenu({ phone, role: 'attendant', outlet: s.outlet, force: true, source: 'prod_day_locked', sessionLike: s }); } catch {}
      return true;
    }
    const prods = await getAssignedProducts(s.code || "");
    const name = prods.find((p) => p.key === key)?.name || key;
    // Guard: already closed product
    if (s.outlet) {
      const closed = await getClosedKeys(cur.date, s.outlet);
        if (closed.has(key)) {
        await sendText(phone, `${name} is already closed for today. Pick another product.`, "AI_DISPATCH_TEXT");
        const remaining = prods.filter((p) => !closed.has(p.key));
        await saveSession(phone, { state: "CLOSING_PICK", ...cur });
        await sendInteractive(listProducts(phone, remaining, s.outlet || "Outlet"), "AI_DISPATCH_INTERACTIVE");
        return true;
      }
    }
    // Attach current item and fetch opening stock for this product so the attendant
    // sees the same information the web UI shows. If no opening is found, fall
    // back to yesterday's closing baseline. Always communicate the result then
    // prompt for closing qty.
    cur.currentItem = { key, name };
    // Query today's supply opening rows and match item by key (case-safe),
    // then communicate the best available baseline. Avoid contradictory messages.
    if (s.outlet) {
      try {
        const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName: s.outlet, date: cur.date } }).catch(() => []);
        const opening = (rows || []).find((r: any) => String(r.itemKey) === key) ||
                        (rows || []).find((r: any) => String(r.itemKey).toLowerCase() === String(key).toLowerCase());
        if (opening) {
          await sendText(phone, `Opening stock for ${name} (${s.outlet} — ${cur.date}): ${fmtQty(Number(opening.qty || 0))} ${opening.unit || "kg"}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
        } else {
          // Fall back to yesterday's attendant closing as opening baseline
          const y = prevDateISO(cur.date);
          const prev = await (prisma as any).attendantClosing.findFirst({ where: { outletName: s.outlet, date: y, itemKey: key } }).catch(() => null);
          if (prev) {
            await sendText(phone, `Opening baseline (yesterday closing) for ${name} (${s.outlet} — ${cur.date}): ${fmtQty(Number(prev.closingQty || 0))}` , "AI_DISPATCH_TEXT", { gpt_sent: true });
          }
          // If neither opening nor baseline was found, remain silent and go straight to qty prompt.
        }
      } catch (err) {
        // Non-fatal: still prompt for qty
        console.warn("failed to fetch opening stock", err);
      }
    }
    await saveSession(phone, { state: "CLOSING_QTY", ...cur });
    const phoneE164 = phone.startsWith("+") ? phone : "+" + phone;
    const stateSnapshot = await getWaState(phoneE164);
    const existingDraft = stateSnapshot.closingDraft ?? { products: {}, orderedIds: [] };
    const draftProducts = { ...existingDraft.products };
    const currentOrdered = existingDraft.orderedIds ?? [];
    const draftOrdered = Array.from(new Set([...currentOrdered, key]));
    const existingRow = cur.rows.find((r) => r.key === key);
    const existingQty = draftProducts[key]?.qty ?? Number(existingRow?.closing ?? 0);
    draftProducts[key] = { productKey: key, name, qty: existingQty };
    await updateWaState(phoneE164, {
      attendantCode: s.code ?? undefined,
      outletName: s.outlet ?? undefined,
      currentAction: "closing",
      closingDraft: {
        products: draftProducts,
        orderedIds: draftOrdered,
        selectedProductId: key,
        lastUpdated: new Date().toISOString(),
      },
      lastMessageAt: new Date().toISOString(),
    });

    const promptText = buildQuantityPromptText(name);
    const navButtons = buildNavigationRow();
    const payload = buildButtonPayload(phone.replace(/^\+/, ""), promptText, navButtons);
    await sendInteractive(payload as any, "AI_DISPATCH_INTERACTIVE");
    return true;
  }

  // Waste/Skip buttons
  if (id === "WASTE_YES") {
    if (!cur.currentItem) {
      await sendText(phone, "Pick a product first.", "AI_DISPATCH_TEXT");
      return true;
    }
    await saveSession(phone, { state: "CLOSING_WASTE_QTY", ...cur });
    await sendInteractive(promptWaste(phone, cur.currentItem.name), "AI_DISPATCH_INTERACTIVE");
    return true;
  }
  if (id === "WASTE_SKIP") {
    if (!cur.currentItem) {
      await sendText(phone, "Pick a product first.", "AI_DISPATCH_TEXT");
      return true;
    }
    cur.currentItem.waste = 0;
    upsertRow(cur, cur.currentItem.key, { name: cur.currentItem.name, closing: cur.currentItem.closing || 0, waste: 0 });
    // Send per-item sales summary on skip as well
    try {
      if (s.outlet) {
        const openEff = await computeOpeningEffective(s.outlet, cur.date, cur.currentItem.key);
        const pb = await (prisma as any).pricebookRow.findFirst({ where: { outletName: s.outlet, productKey: cur.currentItem.key, active: true } });
        const soldUnits = Math.max(0, openEff - Number(cur.currentItem.closing || 0) - 0);
        const price = Number((pb as any)?.sellPrice || 0);
        const hasPrice = Number.isFinite(price) && price > 0;
        const value = soldUnits * (hasPrice ? price : 0);
        const pricePart = hasPrice ? ` @ KSh ${price.toLocaleString()}/kg` : "";
        const valuePart = hasPrice ? ` → Sales KSh ${Math.round(value).toLocaleString()}` : "";
  await sendText(phone, `${cur.currentItem.name}: Opening ${fmtQty(openEff)} − Closing ${fmtQty(cur.currentItem.closing || 0)} − Waste 0 = Sold ${fmtQty(soldUnits)}${pricePart}${valuePart}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      }
    } catch {}
    delete cur.currentItem;
    await nextPickOrSummary(phone, s, cur);
    return true;
  }

  if (id === "SUMMARY_CANCEL") {
    await saveSession(phone, { state: "MENU", ...cur, currentItem: undefined });
    await updateWaState(phoneE164, { currentAction: "menu", closingDraft: undefined, lastMessageAt: new Date().toISOString() });
    await sendText(phone, "Closing draft cancelled.", "AI_DISPATCH_TEXT", { gpt_sent: true });
    await safeSendGreetingOrMenu({
      phone,
      role: s.role || "attendant",
      outlet: s.outlet,
      force: true,
      source: "summary_cancel",
      sessionLike: s,
    });
    return true;
  }

  // Summary actions
  if (id === "SUMMARY_SUBMIT") {
    if (!s.outlet) {
      await sendText(phone, "No outlet bound. Ask supervisor.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return true;
    }
    if (await isDayLocked(cur.date, s.outlet)) {
      await sendText(phone, `Day is locked for ${s.outlet} (${cur.date}). Contact Supervisor.`, "AI_DISPATCH_TEXT");
      return true;
    }
    if (!cur.rows.length) {
      await sendText(phone, "No closing entries recorded yet.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return true;
    }
    try {
      await saveClosings({
        date: cur.date,
        outletName: s.outlet,
        rows: cur.rows.map((r) => ({ productKey: r.key, closingQty: r.closing, wasteQty: r.waste })),
      });
    } catch (e: any) {
      // Find the first offending row by recomputing allowed max and notifying
      try {
        const dt = new Date(cur.date + "T00:00:00.000Z"); dt.setUTCDate(dt.getUTCDate() - 1);
        const y = dt.toISOString().slice(0, 10);
        const [prev, supply] = await Promise.all([
          (prisma as any).attendantClosing.findMany({ where: { date: y, outletName: s.outlet } }),
          (prisma as any).supplyOpeningRow.findMany({ where: { date: cur.date, outletName: s.outlet } }),
        ]);
        const byKey = new Map<string, { openEff: number }>();
        for (const r of prev || []) {
          const k = String((r as any).itemKey || ""); if (!k) continue;
          byKey.set(k, { openEff: (byKey.get(k)?.openEff || 0) + Number((r as any).closingQty || 0) });
        }
        for (const r of supply || []) {
          const k = String((r as any).itemKey || ""); if (!k) continue;
          byKey.set(k, { openEff: (byKey.get(k)?.openEff || 0) + Number((r as any).qty || 0) });
        }
        const bad = cur.rows.find((r) => {
          const openEff = Number(byKey.get(r.key)?.openEff || 0);
          const maxClosing = Math.max(0, openEff - Number(r.waste || 0));
          return Number(r.closing || 0) > maxClosing + 1e-6;
        });
        if (bad) {
          const openEff = Number(byKey.get(bad.key)?.openEff || 0);
          const maxClosing = Math.max(0, openEff - Number(bad.waste || 0));
          await sendText(
            phone,
            `Invalid closing for ${bad.name}. Entered ${fmtQty(bad.closing)} with waste ${fmtQty(bad.waste || 0)}. Max allowed: ${fmtQty(maxClosing)}. Opening = yesterday closing + today supply = ${fmtQty(openEff)}. Adjust and try again.`,
            "AI_DISPATCH_TEXT",
            { gpt_sent: true }
          );
        } else {
          await sendText(phone, "Closing validation failed. Please review entries and try again.", "AI_DISPATCH_TEXT", { gpt_sent: true });
        }
      } catch {
        await sendText(phone, "Closing validation failed. Please review entries and try again.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      }
      await saveSession(phone, { state: "CLOSING_PICK", ...cur });
      const available = await getAvailableClosingProducts(s, cur);
      await sendInteractive(listProducts(phone, available, s.outlet || "Outlet"), "AI_DISPATCH_INTERACTIVE");
      return true;
    }
    const totals = await computeDayTotals({ date: cur.date, outletName: s.outlet });
    await notifySupAdm(`Closing submitted for ${s.outlet} (${cur.date}). Expected deposit: KSh ${totals.expectedDeposit}.`);
    const newInactive = [...new Set([...(cur.inactiveKeys || []), ...cur.rows.map((r) => r.key)])];
    await saveSession(phone, {
      state: "WAIT_DEPOSIT",
      rows: [],
      currentItem: undefined,
      inactiveKeys: newInactive,
    });
    await updateWaState(phoneE164, {
      currentAction: "menu",
      closingDraft: undefined,
      lastMessageAt: new Date().toISOString(),
    });
    const successLines = [
      `Closing submitted for ${s.outlet} (${cur.date}).`,
      `Expected deposit: KSh ${totals.expectedDeposit}.`,
      `Paste the M-Pesa SMS when ready.`,
    ];
    await sendText(phone, successLines.join("\n"), "AI_DISPATCH_TEXT", { gpt_sent: true });
    const nextButtons = buildClosingNextActionsButtons();
    const payload = buildButtonPayload(phone.replace(/^\+/, ""), "Next action?", nextButtons);
    await sendInteractive(payload as any, "AI_DISPATCH_INTERACTIVE");
    return true;
  }
  if (id === "SUMMARY_LOCK") {
    if (!s.outlet) {
      await sendText(phone, "No outlet bound. Ask supervisor.", "AI_DISPATCH_TEXT");
      return true;
    }
    if (await isDayLocked(cur.date, s.outlet)) {
      await sendText(phone, `Day is already locked for ${s.outlet} (${cur.date}).`, "AI_DISPATCH_TEXT");
      return true;
    }
    // Save any staged rows then lock the day
    if (cur.rows.length) {
      try {
        await saveClosings({
          date: cur.date,
          outletName: s.outlet,
          rows: cur.rows.map((r) => ({ productKey: r.key, closingQty: r.closing, wasteQty: r.waste })),
        });
      } catch (e: any) {
        // Mirror SUMMARY_SUBMIT error handling
        try {
          const dt = new Date(cur.date + "T00:00:00.000Z"); dt.setUTCDate(dt.getUTCDate() - 1);
          const y = dt.toISOString().slice(0, 10);
          const [prev, supply] = await Promise.all([
            (prisma as any).attendantClosing.findMany({ where: { date: y, outletName: s.outlet } }),
            (prisma as any).supplyOpeningRow.findMany({ where: { date: cur.date, outletName: s.outlet } }),
          ]);
          const byKey = new Map<string, { openEff: number }>();
          for (const r of prev || []) {
            const k = String((r as any).itemKey || ""); if (!k) continue;
            byKey.set(k, { openEff: (byKey.get(k)?.openEff || 0) + Number((r as any).closingQty || 0) });
          }
          for (const r of supply || []) {
            const k = String((r as any).itemKey || ""); if (!k) continue;
            byKey.set(k, { openEff: (byKey.get(k)?.openEff || 0) + Number((r as any).qty || 0) });
          }
          const bad = cur.rows.find((r) => {
            const openEff = Number(byKey.get(r.key)?.openEff || 0);
            const maxClosing = Math.max(0, openEff - Number(r.waste || 0));
            return Number(r.closing || 0) > maxClosing + 1e-6;
          });
          if (bad) {
            const openEff = Number(byKey.get(bad.key)?.openEff || 0);
            const maxClosing = Math.max(0, openEff - Number(bad.waste || 0));
            await sendText(
              phone,
              `Invalid closing for ${bad.name}. Entered ${fmtQty(bad.closing)} with waste ${fmtQty(bad.waste || 0)}. Max allowed: ${fmtQty(maxClosing)}. Opening = yesterday closing + today supply = ${fmtQty(openEff)}. Adjust and try again.`,
              "AI_DISPATCH_TEXT",
              { gpt_sent: true }
            );
          } else {
            await sendText(phone, "Closing validation failed. Please review entries and try again.", "AI_DISPATCH_TEXT", { gpt_sent: true });
          }
        } catch {
          await sendText(phone, "Closing validation failed. Please review entries and try again.", "AI_DISPATCH_TEXT", { gpt_sent: true });
        }
        await saveSession(phone, { state: "CLOSING_PICK", ...cur });
        const available = await getAvailableClosingProducts(s, cur);
        await sendInteractive(listProducts(phone, available, s.outlet || "Outlet"), "AI_DISPATCH_INTERACTIVE");
        return true;
      }
    }
    await lockDay(cur.date, s.outlet, s.code || undefined);
    const totals = await computeDayTotals({ date: cur.date, outletName: s.outlet });
    await notifySupAdm(`Attendant day locked for ${s.outlet} (${cur.date}). Expected deposit: KSh ${totals.expectedDeposit}.`);
    await saveSession(phone, { state: "WAIT_DEPOSIT", ...cur });
    await sendText(phone, `Submitted & locked. Expected deposit: Ksh ${totals.expectedDeposit}.`, "AI_DISPATCH_TEXT");
    return true;
  }
  if (id === "SUMMARY_MODIFY") {
    if (!cur.rows.length) {
      await sendText(phone, "No rows yet. Pick a product first.", "AI_DISPATCH_TEXT");
      return true;
    }
    const items = cur.rows.map((r) => ({ key: r.key, name: r.name }));
    await saveSession(phone, { state: "CLOSING_PICK", ...cur });
    const snapshot = await getWaState(phoneE164);
    const patch: Partial<WaState> = {
      currentAction: "closing",
      lastMessageAt: new Date().toISOString(),
      closingDraft: snapshot.closingDraft
        ? {
            products: snapshot.closingDraft.products,
            orderedIds: snapshot.closingDraft.orderedIds,
            selectedProductId: undefined,
            lastUpdated: new Date().toISOString(),
          }
        : undefined,
    };
    await updateWaState(phoneE164, patch);
    const options = items.slice(0, 10).map((r) => ({
      id: `PROD_${r.key}`,
      title: r.name,
      description: "Edit closing stock",
    }));
    const interactive = buildProductPickerBody(options, items.length > 10 ? `Showing 10 of ${items.length}` : undefined);
    const payload = buildListPayload(phone.replace(/^\+/, ""), interactive);
    await sendInteractive(payload as any, "AI_DISPATCH_INTERACTIVE");
    return true;
  }

  // Expense follow-ups
  if (id === "EXP_ADD_ANOTHER") {
    await saveSession(phone, { state: "EXPENSE_NAME", ...cur });
    await sendInteractive(expenseNamePrompt(phone), "AI_DISPATCH_INTERACTIVE");
    return true;
  }
  if (id === "EXP_FINISH") {
    await saveSession(phone, { state: "MENU", ...cur, expenseName: undefined });
    await safeSendGreetingOrMenu({
      phone,
      role: s.role || "attendant",
      outlet: s.outlet,
      force: true,
      source: "expense_finish",
      sessionLike: s,
    });
    return true;
  }

  return false;
}

async function nextPickOrSummary(phone: string, s: any, cur: Cursor) {
  const phoneE164 = phone.startsWith("+") ? phone : "+" + phone;
  const prods = await getAvailableClosingProducts(s, cur);
  const inactive = new Set(cur.inactiveKeys || []);
  let remaining = prods.filter((p) => !inactive.has(p.key) && !cur.rows.some((r) => r.key === p.key));
  if (!remaining.length) {
    await saveSession(phone, { state: "SUMMARY", ...cur });
    const reviewLines = (cur.rows || []).map((r) => {
      const closingQty = Number(r.closing ?? 0);
      const wasteQty = Number(r.waste ?? 0);
      const wasteText = wasteQty ? ` (waste ${fmtQty(wasteQty)})` : "";
      return `- ${r.name}: ${fmtQty(closingQty)}${wasteText}`;
    });
    const summaryText = buildReviewSummaryText(s.outlet || "Outlet", reviewLines);
    const summaryButtons = buildClosingReviewButtons();
    const summaryPayload = buildButtonPayload(phone.replace(/^\+/, ""), summaryText, summaryButtons);
    const stateSnapshot = await getWaState(phoneE164);
    const closingDraftPatch = stateSnapshot.closingDraft
      ? {
          products: stateSnapshot.closingDraft.products,
          orderedIds: stateSnapshot.closingDraft.orderedIds,
          selectedProductId: undefined,
          lastUpdated: new Date().toISOString(),
        }
      : undefined;
    const patch: Partial<WaState> = { currentAction: "closing", lastMessageAt: new Date().toISOString() };
    if (closingDraftPatch) patch.closingDraft = closingDraftPatch;
    await updateWaState(phoneE164, patch);
    await sendInteractive(summaryPayload as any, "AI_DISPATCH_INTERACTIVE");
  } else {
    await saveSession(phone, { state: "CLOSING_PICK", ...cur });
    await sendInteractive(listProducts(phone, remaining, s.outlet || "Outlet"), "AI_DISPATCH_INTERACTIVE");
  }
}
