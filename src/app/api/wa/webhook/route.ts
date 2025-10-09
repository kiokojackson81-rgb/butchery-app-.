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
// Legacy role menus are disabled under GPT-only; use six-tabs helper instead
import { sendSixTabs } from "@/lib/wa_buttons";
import { runGptForIncoming } from "@/lib/gpt_router";
import { toGraphPhone } from "@/server/canon";
import { touchWaSession } from "@/lib/waSession";
import { validateOOC, sanitizeForLog } from "@/lib/ooc_guard";
import { parseOOCBlock, stripOOC, buildUnauthenticatedReply, buildAuthenticatedReply } from "@/lib/ooc_parse";
import { sendInteractive as sendInteractiveLib } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    SUPL_DELIVERY: "Submit Delivery",
    SUPL_VIEW_OPENING: "View Opening",
    SUPL_DISPUTES: "Disputes",
    LOGIN: "Login",
    HELP: "Help",
  };

  function humanTitle(id: string) {
    return buttonTitleMap[id] || id.replace(/_/g, " ").slice(0, 40);
  }

  // Build and send interactive reply with reply buttons (2-4)
  async function sendButtonsFor(phoneGraph: string, buttons: string[]) {
    try {
      if (!Array.isArray(buttons) || !buttons.length) return;
      const b = buttons.slice(0, 4).map((id) => ({ type: "reply", reply: { id, title: humanTitle(id) } }));
      await sendInteractive({ messaging_product: "whatsapp", to: phoneGraph, type: "interactive", interactive: { type: "button", body: { text: "Choose an action:" }, action: { buttons: b } } } as any, "AI_DISPATCH_INTERACTIVE");
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
          const sendTextSafe = async (to: string, text: string, ctx: string = "AI_DISPATCH_TEXT") => {
            try { console.info("[WA] SENDING", { type: "text", ctx }); } catch {}
            const r = await sendText(to, text, ctx, { inReplyTo: wamid });
            markSent();
            return r;
          };
          const sendRoleTabs = async (to: string, role: string, outlet?: string) => {
            try { console.info("[WA] SENDING", { type: "interactive.buttons", role }); } catch {}
            // Use GPT-driven buttons (fallback to role defaults)
            const def = (role === 'supervisor') ? ["SV_REVIEW_CLOSINGS","SV_REVIEW_DEPOSITS","SV_REVIEW_EXPENSES"] : (role === 'supplier') ? ["SUPL_DELIVERY","SUPL_VIEW_OPENING","SUPL_DISPUTES"] : ["ATT_CLOSING","ATT_DEPOSIT","MENU_SUMMARY"];
            await sendButtonsFor(to, def);
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
          const auth = await ensureAuthenticated(phoneE164);
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
            // Universal guard: send login prompt at most once per 24 hours per phone
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
                try { await sendTextSafe(to, reply.text, "AI_DISPATCH_TEXT"); } catch {}
              } else {
                // Suppressed duplicate login prompt → still send a lightweight reminder (deduped). OOC logged only.
                const reply = buildUnauthenticatedReply(url, true);
                const to = toGraphPhone(phoneE164);
                try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: reply.ooc } }, status: "INFO", type: "OOC_INFO" }); } catch {}
                try { await sendTextSafe(to, reply.text, "AI_DISPATCH_TEXT"); } catch {}
              }
            } catch {}
            try { await touchWaSession(phoneE164); } catch {}
            continue;
          }

          const sessRole = String(auth.sess?.role || "attendant");
          try { await touchWaSession(phoneE164); } catch {}

          // GPT-Only Routing: when enabled, bypass legacy fast-paths and send all text to GPT
          if (GPT_ONLY && (type === "text" || type === "interactive")) {
            // Normalize inbound into a text prompt for GPT
            const text = (() => {
              if (type === "text") return (m.text?.body ?? "").trim();
              const lr = (m as any)?.interactive?.list_reply?.id as string | undefined;
              const br = (m as any)?.interactive?.button_reply?.id as string | undefined;
              const title = (m as any)?.interactive?.list_reply?.title || (m as any)?.interactive?.button_reply?.title;
              const id = lr || br || "";
              return `[button:${id}] ${title || ""}`.trim();
            })();

            // Direct digit mapping (1-7) to flows — when GPT_ONLY is enabled we intentionally
            // skip the legacy direct-handler path so digits are routed through GPT for consistent
            // OOC generation and reply composition. When GPT_ONLY is disabled, preserve the
            // prior faster direct mapping behavior.
            const digit = String(text || "").trim();
            if (/^[1-7]$/.test(digit)) {
              if (!GPT_ONLY) {
                try {
                  const id = mapDigitToId(sessRole, digit);
                  const flowId = canonicalToFlowId(sessRole, id);
                  if (sessRole === "supervisor") await handleSupervisorAction(auth.sess, flowId, phoneE164);
                  else if (sessRole === "supplier") await handleSupplierAction(auth.sess, flowId, phoneE164);
                  else await handleAuthenticatedInteractive(auth.sess, flowId);
                  const to = toGraphPhone(phoneE164);
                  // Do not send a bare 'OK.' ack — follow with role tabs (if enabled).
                  // If the handler didn't emit any outbound message, send a brief friendly follow-up (only when tabs are disabled).
                  try {
                    if (!__sentOnce && !TABS_ENABLED) {
                      try { await sendTextSafe(to, "All set — see options below.", "AI_DISPATCH_TEXT"); } catch {}
                    }
                  } catch {}
                  try { await sendRoleTabs(to, (sessRole as any) || "attendant", auth.sess?.outlet || undefined); } catch {}
                  try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, flowId }, event: "digit.direct" }, status: "OK", type: "DIGIT_DIRECT" }); } catch {}
                  continue;
                } catch {}
              }
              // When GPT_ONLY is true we let the digit fallthrough to the GPT path below
              // so the conversation remains GPT-driven and OOC is produced/validated.
            }
            // Mark GPT-only path entry
            try { await logOutbound({ direction: "in", templateName: null, payload: { in_reply_to: wamid, phone: phoneE164, event: "gpt_only.enter", text }, status: "INFO", type: "GPT_ONLY_INBOUND" }); } catch {}

            // Call GPT
            try { console.info("[WA] BEFORE GPT", { textLen: text?.length }); } catch {}
            const r = await runGptForIncoming(phoneE164, text);
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
                const retry = await runGptForIncoming(phoneE164, retryPrompt);
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
              if (!TABS_ENABLED) return;
              const to = toGraphPhone(phoneE164);
              await sendRoleTabs(to, (sessRole as any) || "attendant", auth.sess?.outlet || undefined);
            };

            // (oocRequired already computed above)
            if ((!ooc || !ooc.intent) && oocRequired) {
              // Invalid OOC → clarifier fallback (ops compose) without calling legacy menus
              try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ooc.invalid", preview: replyText.slice(-180) }, status: "WARN", type: "OOC_INVALID" }); } catch {}
              try {
                const to = toGraphPhone(phoneE164);
                const msg = TABS_ENABLED ? "I didn't quite get that. Use the tabs below." : "I didn't quite get that.";
                await sendTextSafe(to, msg, "AI_DISPATCH_TEXT");
              } catch {}
              try { await sendRoleTabsLocal(); } catch {}
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
                  // Attendant
                  "ATT_CLOSING": "ATT_TAB_STOCK",
                  "ATT_DEPOSIT": "ATT_TAB_DEPOSITS",
                  "ATT_EXPENSE": "ATT_TAB_EXPENSES",
                  "MENU_SUMMARY": "ATT_TAB_SUMMARY",
                  "MENU_SUPPLY": "ATT_TAB_SUPPLY",
                  "TILL_COUNT": "ATT_TAB_TILL",
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
                const ALLOWED = new Set([
                  'ATT_CLOSING','ATT_DEPOSIT','ATT_EXPENSE','MENU','MENU_SUMMARY','MENU_SUPPLY','HELP',
                  'SUPL_DELIVERY','SUPL_VIEW_OPENING','SUPL_DISPUTES',
                  'SV_REVIEW_CLOSINGS','SV_REVIEW_DEPOSITS','SV_REVIEW_EXPENSES','SV_APPROVE_UNLOCK','SV_HELP',
                  'LOGIN','FREE_TEXT'
                ]);
                // Normalize and filter buttons to allowed set
                const normalizedIntent = String(ooc.intent || '').toUpperCase();
                const allowedButtons = Array.isArray(ooc.buttons) ? (ooc.buttons as string[]).map(b=>String(b||'').toUpperCase()).filter(b=>ALLOWED.has(b)) : [];
                ooc.buttons = allowedButtons;

                // If the intent is not allowed, treat as invalid OOC and fallback
                if (!ALLOWED.has(normalizedIntent)) {
                  try { await logOutbound({ direction: 'in', templateName: null, payload: { phone: phoneE164, event: 'ooc.invalid.intent', preview: intentCanon, ooc: sanitizeForLog(ooc) }, status: 'WARN', type: 'OOC_INVALID' }); } catch {}
                  try { const to = toGraphPhone(phoneE164); await sendTextSafe(to, "I didn't quite get that. Please choose an action.", 'AI_DISPATCH_TEXT'); } catch {}
                  try { await sendRoleTabsLocal(); } catch {}
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
              if (sessRole === "supervisor") await handleSupervisorAction(auth.sess, flowId, phoneE164);
              else if (sessRole === "supplier") await handleSupplierAction(auth.sess, flowId, phoneE164);
              else await handleAuthenticatedInteractive(auth.sess, flowId);
            } catch {}
            // Send the human-facing display text (must be short)
            if (display) {
              try { await sendTextSafe(to, display, "AI_DISPATCH_TEXT"); } catch {}
            } else {
              // If GPT returned no visible text, generate a clarifier
              try { const clar = generateDefaultClarifier(sessRole); await sendTextSafe(to, clar.text, "AI_DISPATCH_TEXT"); } catch {}
            }
            // Send buttons from OOC if provided; strip OOC is already applied to display
            try {
              const btns = Array.isArray(ooc.buttons) && ooc.buttons.length ? ooc.buttons : null;
              if (btns) {
                await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: sanitizeForLog(ooc) } }, status: "INFO", type: "OOC_BUTTONS" });
                await sendButtonsFor(to, btns);
              } else {
                // fallback role defaults
                await sendRoleTabs(to, (sessRole as any) || "attendant", auth.sess?.outlet || undefined);
              }
            } catch {}
            try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, intent: flowId } }, status: "OK", type: "GPT_ROUTE_SUCCESS" }); } catch {}
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
                  const role = String(auth.sess?.role || "attendant");
                  const to = toGraphPhone(phoneE164);
                  await sendRoleTabs(to, (role as any) || "attendant", auth.sess?.outlet || undefined);
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

                // If unauthenticated: force login prompt even if GPT says otherwise
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
                        await sendTextSafe(toGraphPhone(phoneE164), reply.text, "AI_DISPATCH_TEXT");
                      } else {
                        const reply = buildUnauthenticatedReply(url, true);
                        try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: reply.ooc } }, status: "INFO", type: "OOC_INFO" }); } catch {}
                        await sendTextSafe(toGraphPhone(phoneE164), reply.text, "AI_DISPATCH_TEXT");
                      }
                    } catch {}
                    continue;
                }

                // Missing/invalid OOC → treat as FREE_TEXT and fall back to menu
                const intent = String(ooc?.intent || "").toUpperCase();
                if (!ooc || !intent) {
                  const role = String(auth.sess?.role || "attendant");
                  const to = toGraphPhone(phoneE164);
                  await sendRoleTabs(to, (role as any) || "attendant", auth.sess?.outlet || undefined);
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
                    await handleAuthenticatedInteractive(auth.sess, mapped);
                    await sendTextSafe(toGraphPhone(phoneE164), r, "AI_DISPATCH_TEXT");
                    await logOutbound({ direction: "out", templateName: null, payload: { in_reply_to: wamid, phone: phoneE164, meta: { phoneE164, ooc } }, status: "SENT", type: "AI_DISPATCH_TEXT" });
                    continue;
                  }
                }

                // Default: just send the GPT text and fall back to menu if vague
                await sendTextSafe(toGraphPhone(phoneE164), stripOOC(r), "AI_DISPATCH_TEXT");
                await logOutbound({ direction: "out", templateName: null, payload: { in_reply_to: wamid, phone: phoneE164 }, status: "SENT", type: "AI_DISPATCH_TEXT" });
                continue;
              } else {
                const role = String(auth.sess?.role || "attendant");
                const to = toGraphPhone(phoneE164);
                await sendRoleTabs(to, (role as any) || "attendant", auth.sess?.outlet || undefined);
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
            // GPT echo on interactive to record OOC and validate intent (when GPT_ONLY)
            if (GPT_ONLY) {
              try {
                const echo = `user selected ${id}`;
                const r = await runGptForIncoming(phoneE164, echo);
                const replyText = String(r || "").trim();
                const ooc = (() => {
                  try {
                    const start = replyText.lastIndexOf("<<<OOC>");
                    const end = replyText.lastIndexOf("</OOC>>>");
                    if (start >= 0 && end > start) {
                      const jsonPart = replyText.substring(start + 7, end).trim();
                      const parsed = JSON.parse(jsonPart);
                      return parsed;
                    }
                  } catch {}
                  return null;
                })();
                try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc, replyId: id } }, status: "INFO", type: "OOC_INFO" }); } catch {}
                const intent = String(ooc?.intent || "").toUpperCase();
                if (intent && intent !== id) {
                  try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc, replyId: id } }, status: "WARN", type: "OOC_INTENT_MISMATCH" }); } catch {}
                }
              } catch {}
            }
            const flowId = canonicalToFlowId(sessRole, id);
            if (sessRole === "supervisor") await handleSupervisorAction(auth.sess, flowId, phoneE164);
            else if (sessRole === "supplier") await handleSupplierAction(auth.sess, flowId, phoneE164);
            else await handleAuthenticatedInteractive(auth.sess, flowId);
            // If handler didn't send anything, provide a tiny human follow-up when tabs are disabled
            try {
              if (!__sentOnce && !TABS_ENABLED) {
                try { await sendTextSafe(toGraphPhone(phoneE164), "All set — see options below.", "AI_DISPATCH_TEXT"); } catch {}
              }
            } catch {}
            // Always follow with tabs menu for role (six tabs)
            try { await sendRoleTabs(toGraphPhone(phoneE164), (sessRole as any) || "attendant", auth.sess?.outlet || undefined); } catch {}
            try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, intent: id } }, status: "OK", type: "GPT_ROUTE_SUCCESS" }); } catch {}
            continue;
          }

          if (type === "text" && !GPT_ONLY) {
            const text = (m.text?.body ?? "").trim();
            if (sessRole === "supervisor") {
              await handleSupervisorText(auth.sess, text, phoneE164);
            } else if (sessRole === "supplier") {
              await handleSupplierText(auth.sess, text, phoneE164);
            } else {
              await handleAuthenticatedText(auth.sess, text);
            }
            continue;
          }

          // Safety net: avoid silence for any other types (images, audio, unknown)
          try {
            const to = toGraphPhone(phoneE164);
            if (!TABS_ENABLED) {
              await sendTextSafe(to, "I can only read text and button replies for now.", "AI_DISPATCH_TEXT");
            }
            await sendRoleTabs(to, (sessRole as any) || "attendant", auth.sess?.outlet || undefined);
            await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "fallback.unknown_type", type }, status: "INFO", type: "FALLBACK_UNKNOWN" });
          } catch {}
          // Final basic guard for this message (best-effort; may be skipped if earlier paths continued)
          try {
            if (!__sentOnce) {
              console.warn("[WA] SILENCE_GUARD fired", { wamid, phone: phoneE164 });
              const to = toGraphPhone(phoneE164);
              if (!TABS_ENABLED) {
                await sendTextSafe(to, "I didn't quite get that.", "AI_DISPATCH_TEXT");
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
