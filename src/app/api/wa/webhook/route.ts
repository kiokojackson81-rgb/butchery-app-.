import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { logOutbound, updateStatusByWamid } from "@/lib/wa";
import { logMessage } from "@/lib/wa_log";
import { promptWebLogin } from "@/server/wa_gate";
import { createLoginLink } from "@/server/wa_links";
import { ensureAuthenticated, handleAuthenticatedText, handleAuthenticatedInteractive } from "@/server/wa_attendant_flow";
import { handleSupervisorText, handleSupervisorAction } from "@/server/wa/wa_supervisor_flow";
import { handleSupplierAction, handleSupplierText } from "@/server/wa/wa_supplier_flow";
import { sendText, sendInteractive } from "@/lib/wa";
import { runGptForIncoming } from "@/lib/gpt_router";
import { saveClosings } from "@/server/closings";
import { addDeposit, parseMpesaText } from "@/server/deposits";
import { reviewItem } from "@/server/supervisor/review.service";
import { notifyAttendants as notifyAttendantsSupervisor, notifySupplier as notifySupplierSupervisor } from "@/server/supervisor/supervisor.notifications";
import { enqueueOpsEvent } from "@/lib/opsEvents";
import { toGraphPhone } from "@/server/canon";
import { touchWaSession } from "@/lib/waSession";
import { validateOOC, sanitizeForLog } from "@/lib/ooc_guard";
import { parseOOCBlock, stripOOC, buildUnauthenticatedReply, buildAuthenticatedReply } from "@/lib/ooc_parse";
import { sendInteractive as sendInteractiveLib } from "@/lib/wa";
import { buildInteractiveListPayload } from "@/lib/wa_messages";
import { sendGptGreeting } from '@/lib/wa_gpt_helpers';
import { trySendGptInteractive } from '@/lib/wa_gpt_interact';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ATTENDANT_MENU_BUTTONS = new Set([
  "ATT_CLOSING",
  "MENU_SUPPLY",
  "ATT_EXPENSE",
  "MENU_TXNS",
  "MENU_SUMMARY",
  "ATT_DEPOSIT",
  "MENU",
  "HELP",
  "LOGOUT",
]);
const ATTENDANT_MENU_INTENTS = new Set(["MENU", "HELP", "FREE_TEXT", "LOGIN"]);

// Type guard helper for auth union returned by ensureAuthenticated()
function authOk(a: any): a is { ok: true; sess: any } {
  return !!a && !!a.ok && !!a.sess;
}

function verifySignature(body: string, sig: string | null) {
  try {
    const appSecret = process.env.WHATSAPP_APP_SECRET!;
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(body).digest("hex");
    return !!sig && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// (moved to src/lib/ooc_parse.ts)

// GET: verification
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const hubChallenge = searchParams.get("hub.challenge");
  const vt = process.env.WHATSAPP_VERIFY_TOKEN || "barakaops-verify";

  if (mode === "subscribe" && token === vt && hubChallenge) {
    return new NextResponse(hubChallenge, { status: 200 });
  }
  return NextResponse.json({ ok: false }, { status: 403 });
}

// POST: receive events
export async function POST(req: Request) {
  // Helper: human-friendly button titles for known ids
  const buttonTitleMap: Record<string, string> = {
    ATT_CLOSING: "Enter Closing",
    ATT_DEPOSIT: "Deposit",
    ATT_EXPENSE: "Expense",
    ATT_TAB_SUMMARY: "Summary",
    MENU_SUMMARY: "Summary",
    ATT_TAB_SUPPLY: "Supply",
    SV_REVIEW_CLOSINGS: "Review Closings",
    SV_REVIEW_DEPOSITS: "Review Deposits",
    SV_REVIEW_EXPENSES: "Review Expenses",
    SV_APPROVE_UNLOCK: "Unlock / Approve",
  SV_PRICEBOOK: "Pricebook",
  SV_SUMMARY: "Portfolio Summary",
    SUPL_DELIVERY: "Submit Delivery",
    SUPL_VIEW_OPENING: "View Opening",
    SUPL_DISPUTES: "Disputes",
  SUPL_HISTORY: "History",
    LOGIN: "Login",
    HELP: "Help",
  };

  function humanTitle(id: string) {
    return buttonTitleMap[id] || id.replace(/_/g, " ").slice(0, 40);
  }

  // Build and send interactive reply with reply buttons (2-4)
  async function sendButtonsFor(phoneGraph: string, buttons: string[]) {
    try {
      // Send reply buttons (ensure max 3 reply buttons for Graph API)
      if (!Array.isArray(buttons) || !buttons.length) return;
      // Ensure Back to Menu is present but cap visible user buttons to 3
      // (WhatsApp allows max 3 reply buttons). We'll include BACK_TO_MENU as
      // the last button if there's room; otherwise prefer the first 3 options.
      const normalized = [...new Set(buttons.map((b) => String(b || "").toUpperCase()))];
      // Remove BACK_TO_MENU from the pool so we can decide placement
      const withoutBack = normalized.filter((id) => id !== "BACK_TO_MENU");
      const userTake = withoutBack.slice(0, 3);
      // If there is room (less than 3 user buttons) and BACK_TO_MENU wasn't included
      // already, append it to the end so user can return to menu.
      if (userTake.length < 3 && normalized.includes("BACK_TO_MENU") === false) {
        userTake.push("BACK_TO_MENU");
      }

      // Build reply buttons from selected ids
      const b = userTake.map((id) => ({ type: "reply", reply: { id, title: humanTitle(id) } }));
      const fallbackText = ["Choose an action:", ...userTake.map((id, idx) => `${idx + 1}) ${humanTitle(id)}`)].join("\n");

      const interactiveEnabled = process.env.WA_INTERACTIVE_ENABLED === "true";
      let delivered = false;

      if (interactiveEnabled) {
        try {
          const result = await sendInteractive(
            {
              messaging_product: "whatsapp",
              to: phoneGraph,
              type: "interactive",
              interactive: { type: "button", body: { text: "Choose an action:" }, action: { buttons: b } },
            } as any,
            "AI_DISPATCH_INTERACTIVE",
          );
          const response = (result as any)?.response;
          delivered =
            result?.ok === true &&
            !(response && (response as any).noop === true) &&
            !(response && (response as any).dryRun === true);
        } catch (err) {
          try { console.warn('[WA] sendButtonsFor interactive failed', err instanceof Error ? err.message : err); } catch {}
        }
      }

      if (!delivered) {
        await sendText(phoneGraph, fallbackText, "AI_DISPATCH_TEXT", { gpt_sent: true });
      }
    } catch {}
  }

  // Small fallback clarifier when GPT fails
  function generateDefaultClarifier(role: string) {
    if (role === "supervisor") {
      return { text: "Just checking in… what would you like to do?", buttons: ["SV_REVIEW_CLOSINGS", "SV_REVIEW_DEPOSITS", "SV_REVIEW_EXPENSES"] };
    }
    if (role === "supplier") {
      return { text: "Just checking in… what would you like to do?", buttons: ["SUPL_DELIVERY", "SUPL_VIEW_OPENING", "SUPL_DISPUTES"] };
    }
    // Keep attendant clarifier to at most 3 options to avoid interactive limits
    return { text: "Just checking in… what would you like to do?", buttons: ["ATT_CLOSING", "ATT_DEPOSIT", "MENU_SUMMARY"] };
  }
          // Canonical intent/button ID helpers
          function aliasToCanonical(id: string): string {
            const u = String(id || "").toUpperCase();
            const map: Record<string, string> = {
              // Attendant legacy → canonical tabs
              "ATT_CLOSING": "ATT_TAB_STOCK",
              "ATT_DEPOSIT": "ATT_TAB_DEPOSITS",
              "ATT_EXPENSE": "ATT_TAB_EXPENSES",
              "MENU_SUPPLY": "ATT_TAB_SUPPLY",
              "MENU_SUMMARY": "ATT_TAB_SUMMARY",
              "TILL_COUNT": "ATT_TAB_TILL",
              "MENU": "ATT_TAB_SUMMARY",
              // Supplier legacy
              "SPL_DELIVER": "SUP_TAB_SUPPLY_TODAY",
              "SPL_RECENT": "SUP_TAB_VIEW",
              "SPL_DISPUTES": "SUP_TAB_DISPUTE",
              // Supervisor legacy
              "SUP_REVIEW": "SV_TAB_REVIEW_QUEUE",
              "SUP_REPORT": "SV_TAB_SUMMARIES",
              "SUP_TXNS": "SV_TAB_SUMMARIES",
            };
            return map[u] || u;
          }
          function canonicalToFlowId(role: string, id: string): string {
            const u = String(id || "").toUpperCase();
            if (role === "supervisor") {
              const map: Record<string, string> = {
                "SV_TAB_REVIEW_QUEUE": "SUP_REVIEW",
                "SV_TAB_SUMMARIES": "SUP_REPORT",
                "SV_TAB_UNLOCK": "SUP_UNLOCK_CONFIRM", // best-effort mapping if supported
                "SV_TAB_HELP": "SUP_REPORT", // fall back to summaries/help
              };
              return map[u] || u;
            }
            if (role === "supplier") {
              const map: Record<string, string> = {
                "SUP_TAB_SUPPLY_TODAY": "SPL_DELIVER",
                "SUP_TAB_VIEW": "SPL_RECENT",
                "SUP_TAB_DISPUTE": "SPL_DISPUTES",
                "SUP_TAB_HELP": "SPL_MENU",
                // Action intents → concrete flow steps
                "SUP_SUPPLY_ADD": "SPL_ADD_MORE",
                "SUP_SUPPLY_CONFIRM": "SPL_SAVE",
              };
              return map[u] || u;
            }
            // attendant (default)
            const map: Record<string, string> = {
              "ATT_TAB_STOCK": "ATT_CLOSING",
              "ATT_TAB_SUPPLY": "MENU_SUPPLY",
              "ATT_TAB_DEPOSITS": "ATT_DEPOSIT",
              "ATT_TAB_EXPENSES": "ATT_EXPENSE",
              "ATT_TAB_TILL": "MENU_TXNS",
              "ATT_TAB_SUMMARY": "MENU_SUMMARY",
              "LOCK_DAY": "SUMMARY_LOCK",
              "LOCK_DAY_CONFIRM": "SUMMARY_LOCK",
            };
            return map[u] || u;
          }
          function mapDigitToId(role: string, digit: string): string {
            if (role === "supervisor") {
              const map: Record<string, string> = {
                "1": "SV_REVIEW_CLOSINGS",
                "2": "SV_REVIEW_DEPOSITS",
                "3": "SV_REVIEW_EXPENSES",
                "4": "SV_APPROVE_UNLOCK",
                "5": "SV_HELP",
                "6": "SV_HELP",
                "7": "SV_HELP",
              };
              return map[digit] || "SV_HELP";
            } else if (role === "supplier") {
              const map: Record<string, string> = {
                "1": "SUPL_DELIVERY",
                "2": "SUPL_VIEW_OPENING",
                "3": "SUPL_DISPUTES",
                "4": "SUPL_HELP",
                "5": "SUPL_HELP",
                "6": "SUPL_HELP",
                "7": "SUPL_HELP",
              };
              return map[digit] || "SUPL_HELP";
            } else {
              const map: Record<string, string> = {
                "1": "ATT_TAB_STOCK",
                "2": "ATT_TAB_SUPPLY",
                "3": "ATT_TAB_DEPOSITS",
                "4": "ATT_TAB_EXPENSES",
                "5": "ATT_TAB_TILL",
                "6": "ATT_TAB_SUMMARY",
              };
              return map[digit] || "ATT_TAB_SUMMARY";
            }
          }
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
  const GPT_ONLY = String(process.env.WA_GPT_ONLY ?? (process.env.NODE_ENV === "production" ? "true" : "false")).toLowerCase() === "true";
  const TABS_ENABLED = String(process.env.WA_TABS_ENABLED || "false").toLowerCase() === "true";

  // Diagnostic: surface key runtime flags so we can see why sends may be suppressed
  try {
    console.info("[WA] ENV", {
      DRY,
      GPT_ONLY,
      TABS_ENABLED,
      WA_AUTOSEND_ENABLED: String(process.env.WA_AUTOSEND_ENABLED || "false").toLowerCase() === "true",
      WA_INTERACTIVE_ENABLED: String(process.env.WA_INTERACTIVE_ENABLED || "false").toLowerCase() === "true",
      OPENAI_KEY_PRESENT: !!process.env.OPENAI_API_KEY,
      WHATSAPP_TOKEN_PRESENT: !!process.env.WHATSAPP_TOKEN,
      WHATSAPP_PHONE_NUMBER_ID_PRESENT: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
    });
  } catch {}

  if (!verifySignature(raw, sig)) {
    if (!DRY) {
      await logOutbound({ direction: "in", payload: { error: "bad signature" }, status: "ERROR" });
      return NextResponse.json({ ok: true });
    }
    // In dry-run, continue without strict signature enforcement
  }

  const body = JSON.parse(raw || "{}");

  try {
    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const v = change.value || {};
        const msgs = Array.isArray(v.messages) ? v.messages : [];
        const statuses = Array.isArray(v.statuses) ? v.statuses : [];

        // delivery statuses (Graph callbacks)
        for (const s of statuses) {
          const id = s.id as string | undefined;
          const status = s.status as string | undefined;
          if (id && status) await updateStatusByWamid(id, status.toUpperCase());
        }

        // inbound messages
        for (const m of msgs) {
          // Per-message instrumentation and no-silence helpers
          let __sentOnce = false;
          const markSent = () => { __sentOnce = true; };
          const truncateDisplay = (s: string) => {
            try { return String(s || "").slice(0, 400); } catch { return String(s || "").slice(0, 400); }
          };

          const sendTextSafe = async (to: string, text: string, ctx: string = "AI_DISPATCH_TEXT", meta?: { gpt_sent?: boolean }) => {
            try { console.info("[WA] SENDING", { type: "text", ctx, toPreview: String(to).slice(-12), textPreview: String(text || "").slice(0, 120) }); } catch {}
            try {
              const truncated = truncateDisplay(text);
              const r = await sendText(to, truncated, ctx, { inReplyTo: wamid, gpt_sent: meta?.gpt_sent === true });
              markSent();
              try { console.info("[WA] SEND_RESULT", { ok: !!(r as any)?.ok, waMessageId: (r as any)?.waMessageId || null, error: (r as any)?.error || null }); } catch {}
              return r;
            } catch (e: any) {
              try { console.error("[WA] SEND_EXCEPTION", { error: String(e) }); } catch {}
              throw e;
            }
          };
          const sendRoleTabs = async (to: string, role: string, outlet?: string) => {
            try { console.info("[WA] SENDING tabs", { role }); } catch {}
            const phoneE164 = to.startsWith("+") ? to : `+${to}`;
            try {
              await sendGptGreeting(phoneE164, role, outlet);
            } catch (e) {
              try { console.warn('[WA] sendRoleTabs fallback', String(e)); } catch {}
              try { await sendText(to, "How can I help? Please tell me what you'd like to do.", "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
            }
            markSent();
          };
          const fromGraph = m.from as string | undefined; // 2547...
          const phoneE164 = fromGraph ? `+${fromGraph}` : undefined;
          const type = (m.type as string) || "MESSAGE";
          const wamid = m.id as string | undefined;

          if (!phoneE164) continue;
          try { console.info("[WA] INBOUND start", { wamid, from: fromGraph, kind: type }); } catch {}

          // Idempotency: if we've already sent a reply to this wamid, ignore repeats immediately
          if (wamid) {
            const already = await (prisma as any).waMessageLog.findFirst({ where: { payload: { path: ["in_reply_to"], equals: wamid } as any } }).catch(() => null);
            if (already) continue;
          }

          // Fallback idempotency: dedupe on phone+text within a 30s bucket (covers carriers that alter wamid)
          if (type === "text") {
            try {
              const tsSec = Number((m as any).timestamp || 0);
              const tsMs = Number.isFinite(tsSec) && tsSec > 0 ? tsSec * 1000 : Date.now();
              const windowMs = Number(process.env.WA_IDEMPOTENCY_TEXT_BUCKET_MS || 30000);
              const bucket = Math.floor(tsMs / windowMs);
              const textBody = String(m.text?.body ?? "").trim();
              if (textBody) {
                const key = crypto.createHash("sha1").update(`${phoneE164}|${bucket}|${textBody}`).digest("hex");
                const dupe = await (prisma as any).waMessageLog.findFirst({ where: { status: "INBOUND_DEDUP", payload: { path: ["key"], equals: key } as any } }).catch(() => null);
                if (dupe) {
                  // We've already seen and processed an equivalent message in this short window
                  continue;
                }
                // Mark this window so repeats will be ignored
                // Do NOT set waMessageId for dedup marker to avoid unique constraint collisions
                await logMessage({ direction: "in", templateName: null, waMessageId: null, status: "INBOUND_DEDUP", type: "INBOUND_DEDUP", payload: { phone: phoneE164, key, bucket, preview: textBody.slice(0, 80) } });
              }
            } catch {}
          }

          // Log inbound after idempotency gate
          try {
            await logMessage({ direction: "in", templateName: null, payload: m as any, waMessageId: wamid || null, status: type });
          } catch {}

          // Reopen handled centrally in transport via sendWithReopen

          // Helper button: resend login link
          const maybeButtonId = (m as any)?.button?.payload || (m as any)?.button?.text || m?.interactive?.button_reply?.id;
          if (maybeButtonId === "open_login" || maybeButtonId === "SEND_LOGIN_LINK") {
            await promptWebLogin(phoneE164);
            continue;
          }

          // Refresh activity as early as possible to keep session alive
          try { await touchWaSession(phoneE164); } catch {}
          let auth = await ensureAuthenticated(phoneE164);
          try { console.info('[WA] AUTH', { phone: phoneE164, authOk: !!auth?.ok, reason: (auth as any)?.reason || null, sess: authOk(auth) ? { role: auth.sess.role, outlet: auth.sess.outlet } : null }); } catch {}
          // Quick DB re-check fallback: if ensureAuthenticated said unauthenticated but
          // a session row exists in MENU state with credentials we treat as authenticated.
          if (!auth.ok) {
            try {
              const sessRow = await (prisma as any).waSession.findUnique({ where: { phoneE164 } }).catch(() => null);
              if (sessRow && sessRow.state === 'MENU' && sessRow.code) {
                auth = { ok: true, sess: sessRow } as any;
                try { console.info('[WA] AUTH-FALLBACK ok via direct DB row', { phone: phoneE164, sess: { role: sessRow.role, outlet: sessRow.outlet } }); } catch {}
              }
            } catch (e) { try { console.warn('[WA] AUTH-FALLBACK error', String(e)); } catch {} }
          }
          try {
            await logOutbound({
              direction: "in",
              templateName: null,
              payload: { phone: phoneE164, meta: { phoneE164: phoneE164, session_state: (auth as any)?.sess?.state, has_session: !!(auth as any)?.ok }, event: "inbound.info" },
              status: "INFO",
              type: "INBOUND_INFO",
            });
          } catch {}
            if (!auth.ok) {
            // Pre-send DB re-check + logging: if a concurrent finalize/upsert landed
            // between earlier checks and now, prefer the live DB truth and avoid
            // sending a spurious login prompt. Also log the session row for diagnostics.
            try {
              const preSend = await (prisma as any).waSession.findUnique({ where: { phoneE164 } }).catch(() => null);
              try { console.info('[WA] PRE-SEND LOGIN CHECK', { phone: phoneE164, preSend: preSend ? { state: preSend.state, code: !!preSend.code, cursorStatus: (preSend.cursor||{}).status, lastFinalizeAt: preSend.lastFinalizeAt } : null }); } catch {}
              // Persist the pre-send snapshot in outbound logs so it appears in Diagnostics
              try {
                // Attempt to attach the waMessageLog id for this inbound wamid (if available)
                let waLogId: string | null = null;
                try {
                  if (wamid) {
                    const existingLog = await (prisma as any).waMessageLog.findFirst({ where: { waMessageId: wamid as any }, select: { id: true } }).catch(() => null);
                    if (existingLog) waLogId = existingLog.id;
                  }
                } catch {}
                await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, wamid: wamid || null, waMessageLogId: waLogId, preSend: preSend ? { state: preSend.state, hasCode: !!preSend.code, cursorStatus: (preSend.cursor||{}).status, lastFinalizeAt: preSend.lastFinalizeAt } : null } , event: "pre_send_login_check" }, status: "INFO", type: "PRE_SEND_CHECK" });
              } catch {}
              if (preSend && preSend.state === 'MENU' && preSend.code) {
                // Accept the fresh row as authoritative and continue processing as authenticated
                auth = { ok: true, sess: preSend } as any;
                try { console.info('[WA] PRE-SEND LOGIN CHECK: session now active, skipping login prompt', { phone: phoneE164 }); } catch {}
              }
            } catch (e) { try { console.warn('[WA] PRE-SEND LOGIN CHECK error', String(e)); } catch {} }

            // Universal guard: send login prompt at most once per 24 hours per phone
            if (!auth.ok) {
              const windowStart = new Date(Date.now() - 24 * 60 * 60_000);
              const recent = await (prisma as any).waMessageLog.findFirst({
                where: {
                  status: "LOGIN_PROMPT",
                  createdAt: { gt: windowStart },
                  payload: { path: ["phone"], equals: phoneE164 } as any,
                },
                select: { id: true },
              }).catch(() => null);
              if (auth.reason === "expired") {
                try { await (prisma as any).waSession.update({ where: { phoneE164 }, data: { state: "LOGIN" } }); } catch {}
                try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164: phoneE164 }, event: "TTL_EXPIRED" }, status: "TTL_EXPIRED" }); } catch {}
              }
              try {
                const { url } = await createLoginLink(phoneE164).catch(() => ({ url: (process.env.APP_ORIGIN || "https://barakafresh.com") + "/login" }));
                if (!recent) {
                  await logOutbound({ direction: "in", payload: { type: "LOGIN_PROMPT", phone: phoneE164, reason: auth.reason }, status: "LOGIN_PROMPT", type: "WARN" });
                  // send template/reopen via centralized gate (debounced)
                  await promptWebLogin(phoneE164, auth.reason);
                  // Send the strict short nudge (OOC is logged server-side only)
                  const reply = buildUnauthenticatedReply(url, false);
                  const to = toGraphPhone(phoneE164);
                  try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: reply.ooc } }, status: "INFO", type: "OOC_INFO" }); } catch {}
                  try { await sendTextSafe(to, reply.text, "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
                } else {
                  // Suppressed duplicate login prompt → still send a lightweight reminder (deduped). OOC logged only.
                  const reply = buildUnauthenticatedReply(url, true);
                  const to = toGraphPhone(phoneE164);
                  try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: reply.ooc } }, status: "INFO", type: "OOC_INFO" }); } catch {}
                  try { await sendTextSafe(to, reply.text, "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
                }
              } catch {}
              try { await touchWaSession(phoneE164); } catch {}
              continue;
            }
          }

          const _sess = authOk(auth) ? auth.sess : undefined;
          const sessRole = String((_sess?.role) || "attendant");
          try { await touchWaSession(phoneE164); } catch {}

          // Quick numeric shortcut: when GPT_ONLY is disabled, allow users to
          // type a single digit (1-7) to select the corresponding tab/menu
          // option. This mirrors behavior of tapping the UI tabs.
          if (!GPT_ONLY && type === "text") {
            try {
              const typed = String(m.text?.body ?? "").trim();
              if (/^[1-7]$/.test(typed)) {
                const id = mapDigitToId(sessRole, typed);
                const flowId = canonicalToFlowId(sessRole, id);
                let handlerResult: any = null;
                if (sessRole === "supervisor") handlerResult = await handleSupervisorAction(_sess, flowId, phoneE164);
                else if (sessRole === "supplier") handlerResult = await handleSupplierAction(_sess, flowId, phoneE164);
                else handlerResult = await handleAuthenticatedInteractive(_sess, flowId);
                const to = toGraphPhone(phoneE164);
                // If the handler already sent an outbound (truthy result), skip sending role tabs
                if (!handlerResult) {
                  try {
                    if (!__sentOnce && !TABS_ENABLED) {
                      try { await sendTextSafe(to, "All set — see options below.", "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
                    }
                  } catch {}
                  try { await sendRoleTabs(to, (sessRole as any) || "attendant", _sess?.outlet || undefined); } catch {}
                }
                try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, flowId }, event: "digit.direct" }, status: "OK", type: "DIGIT_DIRECT" }); } catch {}
                continue;
              }
            } catch (e) {
              try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164 }, event: "digit.direct.fail", error: String(e) }, status: "ERROR", type: "DIGIT_DIRECT_FAIL" }); } catch {}
            }
          }

          // GPT-Only Routing: when enabled, bypass legacy fast-paths and send all text to GPT
          if (GPT_ONLY && (type === "text" || type === "interactive")) {
            // Normalize inbound into a text prompt for GPT
            let text = (() => {
              if (type === "text") return (m.text?.body ?? "").trim();
              const lr = (m as any)?.interactive?.list_reply?.id as string | undefined;
              const br = (m as any)?.interactive?.button_reply?.id as string | undefined;
              const title = (m as any)?.interactive?.list_reply?.title || (m as any)?.interactive?.button_reply?.title;
              const id = lr || br || "";
              return `[button:${id}] ${title || ""}`.trim();
            })();

            // Normalize bare digit replies into synthetic button taps so GPT receives a
            // consistent signal (and can acknowledge the choice) instead of silently
            // delegating to legacy handlers.
            const digit = String(text || "").trim();
            if (/^[1-7]$/.test(digit)) {
              const id = mapDigitToId(sessRole, digit);
              const flowId = canonicalToFlowId(sessRole, id);
              const title = humanTitle(id);
              text = `[button:${flowId}] ${title}`.trim();
              try {
                await logOutbound({
                  direction: "in",
                  templateName: null,
                  payload: { phone: phoneE164, meta: { phoneE164, digit, mapped: flowId }, event: "digit.normalized" },
                  status: "INFO",
                  type: "DIGIT_NORMALIZED",
                });
              } catch {}
            }
            // Mark GPT-only path entry
            try { await logOutbound({ direction: "in", templateName: null, payload: { in_reply_to: wamid, phone: phoneE164, event: "gpt_only.enter", text }, status: "INFO", type: "GPT_ONLY_INBOUND" }); } catch {}

            // Call GPT
            try { console.info("[WA] BEFORE GPT", { textLen: text?.length }); } catch {}
            try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "BEFORE_GPT", text }, status: "INFO", type: "BEFORE_GPT" }); } catch {}
            const r = await runGptForIncoming(phoneE164, text);
            try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "AFTER_GPT", got: !!r }, status: "INFO", type: "AFTER_GPT" }); } catch {}
            let replyText = String(r || "").trim();

            // Try OOC parse
            let ooc = parseOOCBlock(replyText);

            try { console.info("[WA] AFTER GPT", { gotText: !!replyText, ooc: !!ooc }); } catch {}

            // If OOC is missing/invalid and OOC is required, attempt a single deterministic retry
            // by asking GPT to respond with a valid OOC block. This reduces false negatives where
            // the model forgot to include the OOC in the first reply.
            const oocRequired = String(process.env.WA_OOC_REQUIRED || "true").toLowerCase() === "true";
            if ((!ooc || !ooc.intent) && oocRequired) {
              try {
                const retryPrompt = `${text}\n\nPlease reply with an OOC JSON block only (no extra text). Example:\n<<<OOC>${JSON.stringify({ intent: "MENU", buttons: ["ATT_CLOSING"] })}</OOC>>>`;
                try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "BEFORE_GPT_RETRY", text: retryPrompt }, status: "INFO", type: "BEFORE_GPT" }); } catch {}
                const retry = await runGptForIncoming(phoneE164, retryPrompt);
                try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "AFTER_GPT_RETRY", got: !!retry }, status: "INFO", type: "AFTER_GPT" }); } catch {}
                const retryText = String(retry || "").trim();
                const retryOoc = parseOOCBlock(retryText);
                if (retryOoc && retryOoc.intent) {
                  ooc = retryOoc;
                  // prefer the retry text as the canonical GPT reply for logging/strip
                  replyText = retryText;
                }
              } catch {}
            }

            // Persist OOC sample (sanitized)
            try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: sanitizeForLog(ooc) } }, status: "INFO", type: "OOC_INFO" }); } catch {}

            const sendRoleTabsLocal = async () => {
              if (GPT_ONLY) {
                await sendRoleTabs(toGraphPhone(phoneE164), (sessRole as any) || "attendant", _sess?.outlet || undefined);
                return;
              }
              if (!TABS_ENABLED) return;
              const to = toGraphPhone(phoneE164);
              await sendRoleTabs(to, (sessRole as any) || "attendant", _sess?.outlet || undefined);
            };

            // (oocRequired already computed above)
            if ((!ooc || !ooc.intent) && oocRequired) {
              // Invalid OOC → clarifier fallback (ops compose) without calling legacy menus
              try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ooc.invalid", preview: replyText.slice(-180) }, status: "WARN", type: "OOC_INVALID" }); } catch {}
              try {
                const to = toGraphPhone(phoneE164);
                    // In GPT-only mode prefer GPT to compose a helpful greeting
                    if (GPT_ONLY) {
                      try {
                        await sendGptGreeting(phoneE164, (sessRole as any) || 'attendant', _sess?.outlet || undefined);
                        markSent();
                      } catch {}
                    } else {
                      const msg = "I didn't quite get that. Please tell me what you'd like to do.";
                      await sendTextSafe(to, msg, "AI_DISPATCH_TEXT", { gpt_sent: true });
                    }
              } catch {}
              try { if (TABS_ENABLED) await sendRoleTabsLocal(); } catch {}
              try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "gpt_only.fallback" }, status: "INFO", type: "GPT_ONLY_FALLBACK" }); } catch {}
              continue;
            }

            // Valid OOC intents
            // Normalize provided prompt IDs to our canonical schema before validation
            if (ooc) {
              try {
                const intentRaw = String(ooc.intent || "");
                // Map the Prompt-1 IDs to canonical tab/action IDs
                const idMap: Record<string, string> = {
                  "1": "SUPL_SUBMIT_DELIVERY",
                  "2": "SUPL_VIEW_OPENING",
                  "3": "SUPL_VIEW_STOCK",
                  "4": "SUPL_HELP",
                  "5": "SUPL_HELP",
                  "6": "SUPL_HELP",
                  "7": "SUPL_HELP",
                  // Supervisor
                  "SV_REVIEW_CLOSINGS": "SV_TAB_REVIEW_QUEUE",
                  "SV_REVIEW_DEPOSITS": "SV_TAB_REVIEW_QUEUE",
                  "SV_REVIEW_EXPENSES": "SV_TAB_REVIEW_QUEUE",
                  "SV_APPROVE_UNLOCK": "SV_TAB_UNLOCK",
                  // Supplier
                  "SUPL_DELIVERY": "SUP_TAB_SUPPLY_TODAY",
                  "SUPL_VIEW_OPENING": "SUP_TAB_VIEW",
                  "SUPL_DISPUTES": "SUP_TAB_DISPUTE",
                  // Common
                  "MENU": "MENU",
                  "LOGIN": "LOGIN",
                  "HELP": "HELP",
                  "FREE_TEXT": "FREE_TEXT",
                };
                const intentCanon = idMap[intentRaw] || intentRaw;
                const btns = Array.isArray(ooc.buttons) ? ooc.buttons : [];
                const buttonsCanon = btns.map((b: string) => idMap[b] || b);
                ooc = { ...ooc, intent: intentCanon, buttons: buttonsCanon };

                // Enforce allow-list for intents and buttons to keep GPT within supported flows
                const ALLOWED = new Set<string>([
                  // Supervisor / Supplier canonical tokens
                  'SV_REVIEW_CLOSINGS','SV_REVIEW_DEPOSITS','SV_REVIEW_EXPENSES','SV_APPROVE_UNLOCK','SV_PRICEBOOK','SV_SUMMARY','SV_HELP',
                  'SUPL_DELIVERY','SUPL_VIEW_OPENING','SUPL_DISPUTES','SUPL_HISTORY',
                  // Attendant intents (both legacy ATT_* and canonical ATT_TAB_*)
                  'ATT_CLOSING','ATT_DEPOSIT','ATT_EXPENSE','ATT_TAB_STOCK','ATT_TAB_DEPOSITS','ATT_TAB_EXPENSES','ATT_TAB_SUMMARY',
                  'MENU','MENU_SUMMARY','MENU_SUPPLY','MENU_TXNS','HELP','LOGOUT',
                  // Supplier intents (additional canonical forms)
                  'SUP_TAB_SUPPLY_TODAY','SUP_TAB_VIEW','SUP_TAB_DISPUTE',
                  // Supervisor canonical/tab forms
                  'SV_TAB_REVIEW_QUEUE','SV_TAB_SUMMARIES','SV_TAB_UNLOCK',
                  // Common
                  'LOGIN','FREE_TEXT'
                ]);
                // Normalize and filter buttons to allowed set
                const normalizedIntent = String(ooc.intent || '').toUpperCase();
                const allowedButtons = Array.isArray(ooc.buttons) ? (ooc.buttons as string[]).map(b=>String(b||'').toUpperCase()).filter(b=>ALLOWED.has(b)) : [];
                ooc.buttons = allowedButtons;

                const isAttendant = sessRole === "attendant";
                const looksLikeMenu =
                  allowedButtons.length > 0 &&
                  allowedButtons.every((b) => ATTENDANT_MENU_BUTTONS.has(b));
                if (isAttendant && (ATTENDANT_MENU_INTENTS.has(normalizedIntent) || looksLikeMenu)) {
                  await sendGptGreeting(phoneE164, sessRole, _sess?.outlet || undefined);
                  markSent();
                  continue;
                }

                // If the intent is not allowed, treat as invalid OOC and fallback
                if (!ALLOWED.has(normalizedIntent)) {
                  try { await logOutbound({ direction: 'in', templateName: null, payload: { phone: phoneE164, event: 'ooc.invalid.intent', preview: intentCanon, ooc: sanitizeForLog(ooc) }, status: 'WARN', type: 'OOC_INVALID' }); } catch {}
                  try {
                    if (GPT_ONLY) {
                      try {
                        await sendGptGreeting(phoneE164, (sessRole as any) || 'attendant', _sess?.outlet || undefined);
                        markSent();
                      } catch {}
                    } else {
                      const to = toGraphPhone(phoneE164);
                      await sendTextSafe(to, "I didn't quite get that. Please choose an action.", 'AI_DISPATCH_TEXT', { gpt_sent: true });
                      try { await sendRoleTabsLocal(); } catch {}
                    }
                  } catch {}
                  continue;
                }
              } catch {}
            }
            const chk = validateOOC(ooc);
            if (!chk.ok) {
              try {
                await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ooc.invalid", reason: chk.reason, details: (chk as any).details, ooc: sanitizeForLog(ooc) }, status: "WARN", type: "OOC_INVALID" });
              } catch {}
              try { await sendRoleTabsLocal(); } catch {}
              continue;
            }

            const intentRaw: string = String(ooc.intent || "");
            const canonical = aliasToCanonical(intentRaw);
            const flowId = canonicalToFlowId(sessRole, canonical);
            // Route to role-specific handlers
            const to = toGraphPhone(phoneE164);
            const display = stripOOC(replyText);
            try {
              // Supervisor: allow server-side review actions via OOC (approve/reject)
              if (sessRole === "supervisor") {
                const args = (ooc as any).args || {};
                if (flowId.startsWith("SV") && args && args.id && typeof args.approve === "boolean") {
                  try {
                    await logOutbound({ direction: "in", payload: { phone: phoneE164, event: "SV_REVIEW_CALL", args }, status: "INFO", type: "SV_REVIEW_CALL" });
                    // call review service (idempotent within)
                    const svcRes = await reviewItem({ id: args.id, action: args.approve ? "approve" : "reject", note: args.note || undefined }, _sess?.code || "SUPERVISOR");
                    await logOutbound({ direction: "in", payload: { phone: phoneE164, event: "SV_REVIEW_OK", svcRes }, status: "OK", type: "SV_REVIEW_OK" });
                    try { await sendTextSafe(to, args.approve ? "Approved ✅" : "Rejected ❌", "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
                    try { await sendRoleTabs(to, "supervisor", undefined); } catch {}
                    continue;
                  } catch (e) {
                    await logOutbound({ direction: "in", payload: { phone: phoneE164, event: "SV_REVIEW_FAIL", error: String(e) }, status: "ERROR", type: "SV_REVIEW_FAIL" });
                  }
                }
                // fallback to interactive handler when not handled server-side
                await handleSupervisorAction(_sess, flowId, phoneE164);
              } else if (sessRole === "supplier") {
                // Supplier: allow supply.create via OOC args
                const args = (ooc as any).args || {};
                if (flowId.startsWith("SUP") && args && Array.isArray(args.items) && args.outletId) {
                  try {
                    await logOutbound({ direction: "in", payload: { phone: phoneE164, event: "SUP_CREATE_CALL", args }, status: "INFO", type: "SUP_CREATE_CALL" });
                    // Call existing supply.create API via server internals (prisma)
                    const id = String(Date.now()) + Math.random().toString(36).slice(2, 8);
                    const sup = await (prisma as any).supply.create({ data: { id, outlet_id: args.outletId, supplier_id: _sess?.code || null, eta: args.eta || null, ref: args.ref || null, status: 'submitted', created_by_role: 'supplier', created_by_person: _sess?.code || null } });
                    for (const it of args.items) {
                      await (prisma as any).supplyItem.create({ data: { id: String(Date.now()) + Math.random().toString(36).slice(2,8), supply_id: sup.id, product_id: it.productKey || it.productId, qty: Number(it.qty || 0), unit: it.unit || 'kg', unit_price: it.unitPrice || null } }).catch(()=>{});
                    }
                    await enqueueOpsEvent({ id: String(Date.now()) + Math.random().toString(36).slice(2,8), type: 'SUPPLY_SUBMITTED', entityId: sup.id, outletId: args.outletId, supplierId: _sess?.code || null, actorRole: 'supplier', dedupeKey: `SUPPLY_SUBMITTED:${sup.id}:1` }).catch(()=>{});
                    await logOutbound({ direction: "in", payload: { phone: phoneE164, event: "SUP_CREATE_OK", supplyId: sup.id }, status: "OK", type: "SUP_CREATE_OK" });
                    // notify attendants and supervisors
                    try { await notifyAttendantsSupervisor(args.outletId, `Delivery dispatched — items: ${args.items.map((i:any)=>i.productKey).join(', ')}`); } catch {}
                    try { await notifySupplierSupervisor(args.outletId, `Delivery created for ${args.outletId}`); } catch {}
                    try { await sendTextSafe(to, "Delivery created.", "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
                    try { await sendRoleTabs(to, "supplier", undefined); } catch {}
                    continue;
                  } catch (e) {
                    await logOutbound({ direction: "in", payload: { phone: phoneE164, event: "SUP_CREATE_FAIL", error: String(e) }, status: "ERROR", type: "SUP_CREATE_FAIL" });
                  }
                }
                // fallback
                await handleSupplierAction(_sess, flowId, phoneE164);
              } else {
                // Attendant: attempt direct server-side actions when GPT provided structured args
                let handledByServer = false;
                const args = (ooc && (ooc as any).args) || {};
                try {
                  // Closing submission: expect rows: [{ productKey, closingQty, wasteQty }]
                  if (/CLOSING|STOCK/.test(flowId) && Array.isArray(args.rows) && args.rows.length) {
                    try {
                      const rows = (args.rows || []).map((r: any) => ({ productKey: r.productKey || r.itemKey || r.key, closingQty: Number(r.closingQty || r.closing || 0) || 0, wasteQty: Number(r.wasteQty || r.waste || 0) || 0 }));
                      await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ATTENDANT_CREATE_CALL", kind: "closing", rows }, status: "INFO", type: "ATTENDANT_CREATE_CALL" });
                      await saveClosings({ date: (args.date || (( _sess && (_sess.cursor||{}).date) || new Date().toISOString().slice(0,10) )), outletName: _sess?.outlet || (args.outlet || undefined), rows });
                      await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ATTENDANT_CREATE_OK", kind: "closing", rows }, status: "OK", type: "ATTENDANT_CREATE_OK" });
                      handledByServer = true;
                    } catch (e) {
                      await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ATTENDANT_CREATE_FAIL", kind: "closing", error: String(e) }, status: "ERROR", type: "ATTENDANT_CREATE_FAIL" });
                    }
                  }

                  // Deposit: handle mpesaText or explicit amount
                  if (!handledByServer && /DEPOSIT/.test(flowId) && (args.mpesaText || args.amount)) {
                    try {
                      let parsed = null as any;
                      if (args.mpesaText) parsed = parseMpesaText(String(args.mpesaText || ""));
                      if (!parsed && args.amount) parsed = { amount: Number(args.amount), ref: args.ref || args.note || null };
                      if (parsed) {
                        const date = args.date || ((_sess && (_sess.cursor||{}).date) || new Date().toISOString().slice(0,10));
                        const outletName = _sess?.outlet || args.outlet || null;
                        await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ATTENDANT_CREATE_CALL", kind: "deposit", parsed }, status: "INFO", type: "ATTENDANT_CREATE_CALL" });
                        await addDeposit({ date, outletName: outletName || args.outlet, amount: parsed.amount, note: parsed.ref || null, code: _sess?.code || undefined });
                        await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ATTENDANT_CREATE_OK", kind: "deposit", parsed }, status: "OK", type: "ATTENDANT_CREATE_OK" });
                        handledByServer = true;
                      }
                    } catch (e) {
                      await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ATTENDANT_CREATE_FAIL", kind: "deposit", error: String(e) }, status: "ERROR", type: "ATTENDANT_CREATE_FAIL" });
                    }
                  }

                  // Expense: expect items: [{ name, amount }]
                  if (!handledByServer && /EXPENSE/.test(flowId) && (Array.isArray(args.items) || (args.name && args.amount))) {
                    try {
                      const items = Array.isArray(args.items) ? args.items : [{ name: args.name, amount: args.amount }];
                      const date = args.date || ((_sess && (_sess.cursor||{}).date) || new Date().toISOString().slice(0,10));
                      const outletName = _sess?.outlet || args.outlet || null;
                      const created: any[] = [];
                      for (const it of items) {
                        const name = String(it.name || "").trim();
                        const amount = Number(it.amount || 0);
                        if (!name || !Number.isFinite(amount) || amount <= 0) continue;
                        const exists = await (prisma as any).attendantExpense.findFirst({ where: { date, outletName, name, amount } });
                        if (!exists) {
                          const row = await (prisma as any).attendantExpense.create({ data: { date, outletName, name, amount } });
                          created.push(row);
                        }
                      }
                      await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ATTENDANT_CREATE_OK", kind: "expense", created }, status: "OK", type: "ATTENDANT_CREATE_OK" });
                      handledByServer = true;
                    } catch (e) {
                      await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ATTENDANT_CREATE_FAIL", kind: "expense", error: String(e) }, status: "ERROR", type: "ATTENDANT_CREATE_FAIL" });
                    }
                  }
                } catch (e) {
                  try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ATTENDANT_CREATE_EXCEPTION", error: String(e) }, status: "ERROR", type: "ATTENDANT_CREATE_FAIL" }); } catch {}
                }

                if (!handledByServer) {
                  await handleAuthenticatedInteractive(_sess, flowId);
                  if (flowId === "MENU" && sessRole === "attendant") {
                    markSent();
                    continue;
                  }
                } else {
                  // If server handled the create, send a short confirmation and role tabs
                  try {
                    // Friendly, short confirmations per kind
                    if (/CLOSING|STOCK/.test(flowId)) {
                      await sendTextSafe(to, "Closings saved. Thanks!", "AI_DISPATCH_TEXT", { gpt_sent: true });
                    } else if (/DEPOSIT/.test(flowId)) {
                      // try to include amount when available
                      const amt = (args && (args.mpesaText && parseMpesaText(String(args.mpesaText || ""))?.amount)) || (args && args.amount) || null;
                      const txt = amt ? `Deposit recorded: Ksh ${amt}.` : "Deposit recorded.";
                      await sendTextSafe(to, txt, "AI_DISPATCH_TEXT", { gpt_sent: true });
                    } else if (/EXPENSE/.test(flowId)) {
                      await sendTextSafe(to, "Expense recorded.", "AI_DISPATCH_TEXT", { gpt_sent: true });
                    } else {
                      await sendTextSafe(to, "Saved.", "AI_DISPATCH_TEXT", { gpt_sent: true });
                    }
                  } catch {}
                  try { await sendRoleTabs(to, "attendant", _sess?.outlet || undefined); } catch {}
                  continue;
                }
              }
            } catch {}
            // Send the human-facing display text (must be short)
            if (display) {
              try { await sendTextSafe(to, display, "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
            } else {
              // If GPT returned no visible text, generate a clarifier
              try { const clar = generateDefaultClarifier(sessRole); await sendTextSafe(to, clar.text, "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
            }
            // Send buttons from OOC if provided; strip OOC is already applied to display
            try {
              const btns = Array.isArray(ooc.buttons) && ooc.buttons.length ? ooc.buttons : null;
                if (btns) {
                await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: sanitizeForLog(ooc) } }, status: "INFO", type: "OOC_BUTTONS" });
                try {
                  if (GPT_ONLY) {
                    // Construct a minimal interactive payload from OOC buttons and let
                    // the GPT interactive sender enforce Graph limits and formats.
                    const inter = { type: 'buttons', buttons: (btns as string[]).map((b: string) => ({ id: b, title: humanTitle(b) })), bodyText: 'Choose an action:' } as any;
                    const sent = await trySendGptInteractive(to.replace(/^\+/, ''), inter as any);
                    if (!sent) await sendButtonsFor(to, btns);
                  } else {
                    await sendButtonsFor(to, btns);
                  }
                } catch {}
              } else {
                // fallback role defaults
                await sendRoleTabs(to, (sessRole as any) || "attendant", _sess?.outlet || undefined);
              }
            } catch {}
            try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, intent: flowId } }, status: "OK", type: "GPT_ROUTE_SUCCESS" }); } catch {}
            // Silence guard: if no outbound was produced by handlers or sends, ensure we send a clarifier and log it
            try {
                  if (!__sentOnce) {
                    try { await logOutbound({ direction: "out", templateName: null, payload: { phone: phoneE164, event: "SILENCE_GUARD" }, status: "WARN", type: "SILENCE_GUARD" }); } catch {}
                      // In GPT-only mode, prefer the guarded safe helper to compose and send the greeting/menu
                      if (GPT_ONLY) {
                        try {
                          await sendGptGreeting(phoneE164, (sessRole as any) || 'attendant', _sess?.outlet || undefined);
                          markSent();
                        } catch {}
                      } else {
                        const clar = generateDefaultClarifier(sessRole);
                        const to = toGraphPhone(phoneE164);
                        await sendTextSafe(to, clar.text, "AI_DISPATCH_TEXT", { gpt_sent: true });
                        await sendButtonsFor(to, clar.buttons);
                      }
                  }
            } catch (e) { try { console.warn('[WA] SILENCE_GUARD error', String(e)); } catch {} }
            continue;

            // FREE_TEXT or other → send clarifier with full role tabs
            try { await sendRoleTabsLocal(); } catch {}
            try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "gpt_only.fallback.free_text" }, status: "INFO", type: "GPT_ONLY_FALLBACK" }); } catch {}
            continue;
          }

          // If authenticated and AI is enabled, route remaining free text to GPT with a light intent guard.
          if (type === "text" && String(process.env.WA_AI_ENABLED || "true").toLowerCase() === "true") {
            const text = (m.text?.body ?? "").trim();
            try {
              // Lightweight intent router before GPT
              const lower = text.toLowerCase();
              const keywords: Array<[string, "attendant" | "supervisor" | "supplier"]> = [
                ["closing", "attendant"],
                ["deposit", "attendant"],
                ["expense", "attendant"],
                ["summary", "attendant"],
                ["opening", "supplier"],
                ["supply", "supplier"],
              ];
              const match = keywords.find(([k]) => lower.includes(k));
              if (match) {
                // Fall through to role flows below (handlers implement actual logic)
              } else {
                // Vague/greeting? If <3 words or greeting-like, send quick menu
                const words = lower.split(/\s+/).filter(Boolean);
                const isVague = words.length < 3 || /^(hi|hey|hello|ok|okay|niaje|mambo|sasa|yo)\b/.test(lower);
                if (isVague) {
                  const role = String(_sess?.role || "attendant");
                  const to = toGraphPhone(phoneE164);
                    await sendRoleTabs(to, (role as any) || "attendant", _sess?.outlet || undefined);
                  await logOutbound({ direction: "out", templateName: null, payload: { in_reply_to: wamid, event: "intent.unresolved", phone: phoneE164, text }, status: "SENT", type: "INTENT_UNRESOLVED" });
                  continue;
                }
              }

              // GPT attempt with timeout and single retry; empty response falls back to menu
              const reply = await runGptForIncoming(phoneE164, text);
              const r = String(reply || "").trim();
              if (r) {
                // Try to parse OOC from the tail of the message
                const ooc = parseOOCBlock(r);

                // Log OOC for observability
                try {
                  await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc } }, status: "INFO", type: "OOC_INFO" });
                } catch {}

                // If unauthenticated: perform a pre-send DB re-check and force login prompt only if still unauthenticated
                if (!auth.ok) {
                  try {
                    const preSend = await (prisma as any).waSession.findUnique({ where: { phoneE164 } }).catch(() => null);
                    try { console.info('[WA] PRE-SEND LOGIN CHECK (GPT branch)', { phone: phoneE164, preSend: preSend ? { state: preSend.state, code: !!preSend.code, cursorStatus: (preSend.cursor||{}).status, lastFinalizeAt: preSend.lastFinalizeAt } : null }); } catch {}
                    try {
                      let waLogId: string | null = null;
                      try {
                        if (wamid) {
                          const existingLog = await (prisma as any).waMessageLog.findFirst({ where: { waMessageId: wamid as any }, select: { id: true } }).catch(() => null);
                          if (existingLog) waLogId = existingLog.id;
                        }
                      } catch {}
                      await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, wamid: wamid || null, waMessageLogId: waLogId, preSend: preSend ? { state: preSend.state, hasCode: !!preSend.code, cursorStatus: (preSend.cursor||{}).status, lastFinalizeAt: preSend.lastFinalizeAt } : null } , event: "pre_send_login_check.gpt" }, status: "INFO", type: "PRE_SEND_CHECK" });
                    } catch {}
                    if (preSend && preSend.state === 'MENU' && preSend.code) {
                      auth = { ok: true, sess: preSend } as any;
                      try { console.info('[WA] PRE-SEND LOGIN CHECK (GPT branch): session now active, skipping login prompt', { phone: phoneE164 }); } catch {}
                    }
                  } catch (e) { try { console.warn('[WA] PRE-SEND LOGIN CHECK (GPT branch) error', String(e)); } catch {} }

                  if (!auth.ok) {
                    const windowStart = new Date(Date.now() - 24 * 60 * 60_000);
                    const recent = await (prisma as any).waMessageLog.findFirst({
                      where: { status: "LOGIN_PROMPT", createdAt: { gt: windowStart }, payload: { path: ["phone"], equals: phoneE164 } as any },
                      select: { id: true },
                    }).catch(() => null);
                    try {
                      const { url } = await createLoginLink(phoneE164).catch(() => ({ url: (process.env.APP_ORIGIN || "https://barakafresh.com") + "/login" }));
                      if (!recent) {
                        await logOutbound({ direction: "in", payload: { type: "LOGIN_PROMPT", phone: phoneE164, reason: "unauth.ooc" }, status: "LOGIN_PROMPT", type: "WARN" });
                        await promptWebLogin(phoneE164, "unauth");
                        const reply = buildUnauthenticatedReply(url, false);
                        // Log OOC server-side, do not send to user
                        try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: reply.ooc } }, status: "INFO", type: "OOC_INFO" }); } catch {}
                        await sendTextSafe(toGraphPhone(phoneE164), reply.text, "AI_DISPATCH_TEXT", { gpt_sent: true });
                      } else {
                        const reply = buildUnauthenticatedReply(url, true);
                        try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: reply.ooc } }, status: "INFO", type: "OOC_INFO" }); } catch {}
                        await sendTextSafe(toGraphPhone(phoneE164), reply.text, "AI_DISPATCH_TEXT", { gpt_sent: true });
                      }
                    } catch {}
                    continue;
                  }
                }

                // Missing/invalid OOC → treat as FREE_TEXT and fall back to menu
                const intent = String(ooc?.intent || "").toUpperCase();
                if (!ooc || !intent) {
                  const role = String(_sess?.role || "attendant");
                  const to = toGraphPhone(phoneE164);
                  await sendRoleTabs(to, (role as any) || "attendant", _sess?.outlet || undefined);
                  await logOutbound({ direction: "out", templateName: null, payload: { in_reply_to: wamid, event: "ooc.invalid", phone: phoneE164, text: r }, status: "SENT", type: "INTENT_UNRESOLVED" });
                  continue;
                }

                if (ooc && intent) {
                  // Normalize intent mapping for attendant menus
                  const directMap: Record<string, string> = {
                    "ATT_CLOSING": "ATT_CLOSING",
                    "ATT_DEPOSIT": "ATT_DEPOSIT",
                    "ATT_EXPENSE": "ATT_EXPENSE",
                    "MENU": "MENU",
                    "MENU_SUMMARY": "MENU_SUMMARY",
                    "MENU_SUPPLY": "MENU_SUPPLY",
                    "HELP": "MENU",
                    "LOGIN": "MENU",
                  };
                  const mapped = directMap[intent];
                  if (mapped) {
                    // Deposit safety: attempt MPESA parse for logging before handler
                    try {
                      if (intent === "ATT_DEPOSIT" && ooc?.args?.mpesaText) {
                        const textIn = String(ooc.args.mpesaText || "");
                        // basic parse signature (ref, amount)
                        const m = /Ksh\s*([0-9,]+)\b.*?([A-Z0-9]{10,})/i.exec(textIn);
                        if (m) {
                          const parsed = { amount: Number(m[1].replace(/,/g, "")), ref: m[2] };
                          await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: { ...ooc, args: { ...(ooc.args||{}), parsed } } } }, status: "INFO", type: "OOC_MPESA_PARSED" });
                        }
                      }
                    } catch {}
                    await handleAuthenticatedInteractive(_sess, mapped);
                    await sendTextSafe(toGraphPhone(phoneE164), r, "AI_DISPATCH_TEXT", { gpt_sent: true });
                    await logOutbound({ direction: "out", templateName: null, payload: { in_reply_to: wamid, phone: phoneE164, meta: { phoneE164, ooc } }, status: "SENT", type: "AI_DISPATCH_TEXT" });
                    continue;
                  }
                }

                // Default: just send the GPT text and fall back to menu if vague
                await sendTextSafe(toGraphPhone(phoneE164), stripOOC(r), "AI_DISPATCH_TEXT", { gpt_sent: true });
                await logOutbound({ direction: "out", templateName: null, payload: { in_reply_to: wamid, phone: phoneE164 }, status: "SENT", type: "AI_DISPATCH_TEXT" });
                continue;
              } else {
                const role = String(_sess?.role || "attendant");
                const to = toGraphPhone(phoneE164);
                await sendRoleTabs(to, (role as any) || "attendant", _sess?.outlet || undefined);
                await logOutbound({ direction: "out", templateName: null, payload: { in_reply_to: wamid, event: "intent.unresolved", phone: phoneE164, text, reason: "gpt-empty" }, status: "SENT", type: "INTENT_UNRESOLVED" });
                continue;
              }
            } catch {
              // fall back to role flows below
            }
          }

          // sessRole already computed above
          if (type === "interactive") {
            const interactiveType = m.interactive?.type as string | undefined;
            const listId = m.interactive?.list_reply?.id as string | undefined;
            const buttonId = m.interactive?.button_reply?.id as string | undefined;
            const idRaw = listId || buttonId || "";
            const id = aliasToCanonical(idRaw);
            if (!id) continue;

            // In GPT-only mode, prefer to route interactive selections through GPT
            // so all intent resolution, OOC generation and reply composition is centralized.
            if (GPT_ONLY) {
              try {
                const prompt = `user selected ${id}`;
                const r = await runGptForIncoming(phoneE164, prompt);
                const replyText = String(r || "").trim();
                const ooc = parseOOCBlock(replyText);
                try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc, replyId: id } }, status: "INFO", type: "OOC_INFO" }); } catch {}

                const normalizedButtons = Array.isArray(ooc?.buttons) ? (ooc.buttons as string[]).map((b: string) => String(b || "").toUpperCase()) : [];
                if (sessRole === "attendant" && normalizedButtons.length && normalizedButtons.every((b) => ATTENDANT_MENU_BUTTONS.has(b))) {
                  await sendGptGreeting(phoneE164, sessRole, _sess?.outlet || undefined);
                  markSent();
                  continue;
                }

                const to = toGraphPhone(phoneE164);
                const display = stripOOC(replyText);
                if (display) {
                  try { await sendTextSafe(to, display, "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
                }
                // If GPT returned buttons via OOC, send them; otherwise use role tabs
                try {
                  const btns = Array.isArray(ooc?.buttons) && ooc?.buttons.length ? ooc?.buttons : null;
                  if (btns) {
                    try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: sanitizeForLog(ooc) } }, status: "INFO", type: "OOC_BUTTONS" }); } catch {}
                    try {
                      if (GPT_ONLY) {
                        const inter = { type: 'buttons', buttons: (btns as string[]).map((b: string) => ({ id: b, title: humanTitle(b) })), bodyText: 'Choose an action:' } as any;
                        const sent = await trySendGptInteractive(to.replace(/^\+/, ''), inter as any);
                        if (!sent) await sendButtonsFor(to, btns as string[]);
                      } else {
                        await sendButtonsFor(to, btns as string[]);
                      }
                    } catch {}
                  } else {
                    // Only send role tabs if handler didn't already send a response
                    if (!__sentOnce) await sendRoleTabs(to, (sessRole as any) || "attendant", _sess?.outlet || undefined);
                  }
                } catch {}

                try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, intent: id } }, status: "OK", type: "GPT_ROUTE_SUCCESS" }); } catch {}
              } catch (e) {
                try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "gpt.interactive.fail", error: String(e) }, status: "ERROR", type: "GPT_INTERACTIVE_FAIL" }); } catch {}
                // fallback to legacy behavior if GPT fails
              }
              continue;
            }

            // Route interactive selections through GPT for centralized handling.
            try {
              const prompt = `user selected ${id}`;
              const r = await runGptForIncoming(phoneE164, prompt);
              const replyText = String(r || "").trim();
              const ooc = parseOOCBlock(replyText);
              try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc, replyId: id } }, status: "INFO", type: "OOC_INFO" }); } catch {}
              const to = toGraphPhone(phoneE164);
              const normalizedButtons = Array.isArray(ooc?.buttons) ? (ooc.buttons as string[]).map((b: string) => String(b || "").toUpperCase()) : [];
              if (sessRole === "attendant" && normalizedButtons.length && normalizedButtons.every((b) => ATTENDANT_MENU_BUTTONS.has(b))) {
                await sendGptGreeting(phoneE164, sessRole, _sess?.outlet || undefined);
                markSent();
                continue;
              }
              const display = stripOOC(replyText);
              if (display) {
                try { await sendTextSafe(to, display, "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
              }
              const btns = Array.isArray(ooc?.buttons) && ooc?.buttons.length ? ooc?.buttons : null;
              if (btns) {
                try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: sanitizeForLog(ooc) } }, status: "INFO", type: "OOC_BUTTONS" }); } catch {}
                try {
                  if (GPT_ONLY) {
                    const inter = { type: 'buttons', buttons: (btns as string[]).map((b: string) => ({ id: b, title: humanTitle(b) })), bodyText: 'Choose an action:' } as any;
                    const sent = await trySendGptInteractive(to.replace(/^\+/, ''), inter as any);
                    if (!sent) await sendButtonsFor(to, btns as string[]);
                  } else {
                    await sendButtonsFor(to, btns as string[]);
                  }
                } catch {}
              }
              try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, intent: id } }, status: "OK", type: "GPT_ROUTE_SUCCESS" }); } catch {}
            } catch (e) {
              try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "gpt.interactive.fail", error: String(e) }, status: "ERROR", type: "GPT_INTERACTIVE_FAIL" }); } catch {}
            }
            continue;
          }

          // All text routes now go through GPT-only path above when GPT_ONLY is enabled.
          // For non-GPT deployments, prefer GPT as well for consistent behavior.
          if (type === "text") {
            const text = (m.text?.body ?? "").trim();
            try {
              // Call GPT and send reply (reuse the GPT-only path above by constructing same inputs)
              const r = await runGptForIncoming(phoneE164, text);
              const replyText = String(r || "").trim();
              if (replyText) {
                const display = stripOOC(replyText);
                await sendTextSafe(toGraphPhone(phoneE164), display, "AI_DISPATCH_TEXT", { gpt_sent: true });
                await logOutbound({ direction: "in", templateName: null, payload: { in_reply_to: wamid, phone: phoneE164, meta: { phoneE164 } }, status: "SENT", type: "AI_DISPATCH_TEXT" });
              }
            } catch (e) {
              try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "gpt.text.fail", error: String(e) }, status: "ERROR", type: "GPT_TEXT_FAIL" }); } catch {}
            }
            continue;
          }

          // Safety net: avoid silence for any other types (images, audio, unknown)
          try {
            const to = toGraphPhone(phoneE164);
            if (!TABS_ENABLED) {
                await sendTextSafe(to, "I can only read text and button replies for now.", "AI_DISPATCH_TEXT", { gpt_sent: true });
            }
            await sendRoleTabs(to, (sessRole as any) || "attendant", _sess?.outlet || undefined);
            await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "fallback.unknown_type", type }, status: "INFO", type: "FALLBACK_UNKNOWN" });
          } catch {}
          // Final basic guard for this message (best-effort; may be skipped if earlier paths continued)
          try {
            if (!__sentOnce) {
              console.warn("[WA] SILENCE_GUARD fired", { wamid, phone: phoneE164 });
              const to = toGraphPhone(phoneE164);
              if (!TABS_ENABLED) {
                await sendTextSafe(to, "I didn't quite get that.", "AI_DISPATCH_TEXT", { gpt_sent: true });
              }
              let role: string = "attendant";
              let outlet: string | undefined = undefined;
              try {
                const a: any = await ensureAuthenticated(phoneE164);
                if (a && a.ok && a.sess) {
                  role = String(a.sess.role || role);
                  outlet = a.sess.outlet || undefined;
                }
              } catch {}
              await sendRoleTabs(to, role as any, outlet);
            }
          } catch {}
        }
      }
    }
  } catch (e: any) {
    await logOutbound({ direction: "in", payload: { error: e?.message || String(e) }, status: "ERROR" });
  }

  return NextResponse.json({ ok: true });
}
