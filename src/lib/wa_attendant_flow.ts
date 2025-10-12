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
import { handleSupplyDispute } from "@/server/supply_notify";
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
  return prodsAll.filter((p) => !closed.has(p.key));
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
        try { console.info?.(`[wa] greeting suppressed (reminderSend dup)`, { phoneE164, windowKey, source }); } catch {}
        try { await logOutbound({ direction: 'in', templateName: null, payload: { phoneE164, source, reason: 'reminderSend dup', windowKey }, status: 'INFO', type: 'GREETING_SUPPRESSED' }); } catch {}
        return false;
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
    await sendText(phone, "You've been logged out. We'll send you a login link now.", "AI_DISPATCH_TEXT", { gpt_sent: true });
    await promptLogin(phone);
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
    if (isNumericText(t)) {
      const val = Number(t);
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
      const promptText = `Numbers only for ${itemName}, e.g. 9.5`;
      const payload = buildButtonPayload(phone.replace(/^\+/, ""), promptText, buildNavigationRow());
      await sendInteractive(payload as any, "AI_DISPATCH_INTERACTIVE");
    }
    return;
  }

  // CLOSING_WASTE_QTY numeric gate
  if (s.state === "CLOSING_WASTE_QTY") {
    if (isNumericText(t)) {
      const val = Number(t);
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
      // Immediately persist single row and lock this product for the day
      if (s.outlet) {
        await saveClosings({
          date: cur.date,
          outletName: s.outlet,
          rows: [{ productKey: item.key, closingQty: item.closing || 0, wasteQty: item.waste || 0 }],
        });
      }
      upsertRow(cur, item.key, { name: item.name, closing: item.closing || 0, waste: item.waste || 0 });
      delete cur.currentItem;
      await nextPickOrSummary(phone, s, cur);
    } else {
      await sendText(phone, "Numbers only, e.g. 1.0", "AI_DISPATCH_TEXT", { gpt_sent: true });
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

export async function handleInteractiveReply(phone: string, payload: any): Promise<boolean> {
  const s = await loadSession(phone);
  if (s?.id) await touchSession(s.id);
  const cur: Cursor = (s.cursor as any) || { date: today(), rows: [] };
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
    }
    await sendText(phone, "You've been logged out. We'll send you a login link now.", "AI_DISPATCH_TEXT", { gpt_sent: true });
    await promptLogin(phone);
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
        const options = available.slice(0, 10).map((p) => ({
          id: `PROD_${p.key}`,
          title: p.name || p.key,
          description: "Record closing stock",
        }));
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

    const prodsAll = await getAssignedProducts(s.code);
    const closed = await getClosedKeys(cur.date, s.outlet);
    const prods = prodsAll.filter((p) => !closed.has(p.key));
    if (!prods.length) {
      await nextPickOrSummary(phone, s, cur);
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

    const options = prods.slice(0, 10).map((p) => ({
      id: `PROD_${p.key}`,
      title: p.name || p.key,
      description: "Record closing stock",
    }));
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
    const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName: s.outlet, date: cur.date }, orderBy: { itemKey: "asc" } });
    if (!rows.length) {
      // Fall back to yesterday's closing as opening baseline
      const y = prevDateISO(cur.date);
      const prev = await (prisma as any).attendantClosing.findMany({ where: { outletName: s.outlet, date: y }, orderBy: { itemKey: "asc" } });
      if (!prev.length) {
        await sendText(phone, "No opening stock found yet.", "AI_DISPATCH_TEXT");
        return true;
      }
      const plist = await (prisma as any).product.findMany({ where: { key: { in: prev.map((r: any) => r.itemKey) } } });
      const nameByKey = new Map(plist.map((p: any) => [p.key, p.name] as const));
      const text = prev
        .map((r: any) => `- ${nameByKey.get(r.itemKey) || r.itemKey}: ${r.closingQty}`)
        .join("\n");
      await sendText(phone, `Opening baseline (yesterday closing) for ${s.outlet} (${cur.date}):\n${text}`, "AI_DISPATCH_TEXT");
      return true;
    }
    const plist = await (prisma as any).product.findMany({ where: { key: { in: rows.map((r: any) => r.itemKey) } } });
    const nameByKey = new Map(plist.map((p: any) => [p.key, p.name] as const));
    const text = rows
      .map((r: any) => `- ${nameByKey.get(r.itemKey) || r.itemKey}: ${r.qty} ${r.unit}`)
      .join("\n");
    await sendText(phone, `Opening stock for ${s.outlet} (${cur.date}):\n${text}`, "AI_DISPATCH_TEXT");
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
    // Query today's supply opening row for this outlet/product
    if (s.outlet) {
      try {
        const opening = await (prisma as any).supplyOpeningRow.findFirst({ where: { outletName: s.outlet, date: cur.date, itemKey: key } }).catch(() => null);
        if (opening) {
          await sendText(phone, `Opening stock for ${name} (${s.outlet} — ${cur.date}): ${opening.qty} ${opening.unit || "kg"}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
        } else {
          // Fall back to yesterday's attendant closing as opening baseline
          const y = prevDateISO(cur.date);
          const prev = await (prisma as any).attendantClosing.findFirst({ where: { outletName: s.outlet, date: y, itemKey: key } }).catch(() => null);
          if (prev) {
            await sendText(phone, `Opening baseline (yesterday closing) for ${name} (${s.outlet} — ${cur.date}): ${prev.closingQty}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
          } else {
            // Match web UI wording when no opening stock exists
            await sendText(phone, "No opening stock found yet.", "AI_DISPATCH_TEXT", { gpt_sent: true });
          }
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
    await saveClosings({
      date: cur.date,
      outletName: s.outlet,
      rows: cur.rows.map((r) => ({ productKey: r.key, closingQty: r.closing, wasteQty: r.waste })),
    });
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
      await saveClosings({
        date: cur.date,
        outletName: s.outlet,
        rows: cur.rows.map((r) => ({ productKey: r.key, closingQty: r.closing, wasteQty: r.waste })),
      });
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
  const prods = await getAssignedProducts(s.code || "");
  const inactive = new Set(cur.inactiveKeys || []);
  let remaining = prods.filter((p) => !inactive.has(p.key) && !cur.rows.some((r) => r.key === p.key));
  // Also exclude products already closed in DB
  if (s.outlet) {
    const closed = await getClosedKeys(cur.date, s.outlet);
    remaining = remaining.filter((p) => !closed.has(p.key));
  }
  if (!remaining.length) {
    await saveSession(phone, { state: "SUMMARY", ...cur });
    const reviewLines = (cur.rows || []).map((r) => {
      const closingQty = Number(r.closing ?? 0);
      const wasteQty = Number(r.waste ?? 0);
      const wasteText = wasteQty ? ` (waste ${wasteQty})` : "";
      return `- ${r.name}: ${closingQty}${wasteText}`;
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
