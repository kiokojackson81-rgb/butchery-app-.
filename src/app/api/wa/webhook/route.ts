import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { logOutbound, updateStatusByWamid } from "@/lib/wa";
import { logMessage } from "@/lib/wa_log";
import { promptWebLogin } from "@/server/wa_gate";
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
          const fromGraph = m.from as string | undefined; // 2547...
          const phoneE164 = fromGraph ? `+${fromGraph}` : undefined;
          const type = (m.type as string) || "MESSAGE";
          const wamid = m.id as string | undefined;

          if (!phoneE164) continue;

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
                await logMessage({ direction: "in", templateName: null, waMessageId: wamid || null, status: "INBOUND_DEDUP", type: "INBOUND_DEDUP", payload: { phone: phoneE164, key, bucket, preview: textBody.slice(0, 80) } });
              }
            } catch {}
          }

          // Log inbound after idempotency gate
          try {
            await logMessage({ direction: "in", templateName: null, payload: m as any, waMessageId: wamid || null, status: type });
          } catch {}

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
            if (!recent) {
              await logOutbound({ direction: "in", payload: { type: "LOGIN_PROMPT", phone: phoneE164, reason: auth.reason }, status: "LOGIN_PROMPT", type: "WARN" });
              await promptWebLogin(phoneE164, auth.reason);
            } else {
              // Suppressed duplicate login prompt → still send a lightweight reminder to avoid silence
              try {
                const to = toGraphPhone(phoneE164);
                const origin = process.env.APP_ORIGIN || "https://barakafresh.com";
                const msg = `You're not logged in. Open ${origin}/login to continue.`;
                await sendText(to, msg, "AI_DISPATCH_TEXT");
              } catch {}
            }
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
            // Mark GPT-only path entry
            try { await logOutbound({ direction: "in", templateName: null, payload: { in_reply_to: wamid, phone: phoneE164, event: "gpt_only.enter", text }, status: "INFO", type: "GPT_ONLY_INBOUND" }); } catch {}

            // Call GPT
            const r = await runGptForIncoming(phoneE164, text);
            const replyText = String(r || "").trim();

            // Try OOC parse
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

            // Persist OOC sample (sanitized)
            try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, ooc: sanitizeForLog(ooc) } }, status: "INFO", type: "OOC_INFO" }); } catch {}

            const sendRoleTabs = async () => {
              if (!TABS_ENABLED) return;
              const to = toGraphPhone(phoneE164);
              await sendSixTabs(to, (sessRole as any) || "attendant", auth.sess?.outlet || undefined);
            };

            const oocRequired = String(process.env.WA_OOC_REQUIRED || "true").toLowerCase() === "true";
            if ((!ooc || !ooc.intent) && oocRequired) {
              // Invalid OOC → clarifier fallback (ops compose) without calling legacy menus
              try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ooc.invalid", preview: replyText.slice(-180) }, status: "WARN", type: "OOC_INVALID" }); } catch {}
              try {
                const to = toGraphPhone(phoneE164);
                const msg = TABS_ENABLED ? "I didn't quite get that. Use the tabs below." : "I didn't quite get that.";
                await sendText(to, msg, "AI_DISPATCH_TEXT");
              } catch {}
              try { await sendRoleTabs(); } catch {}
              try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "gpt_only.fallback" }, status: "INFO", type: "GPT_ONLY_FALLBACK" }); } catch {}
              continue;
            }

            // Valid OOC intents
            const chk = validateOOC(ooc);
            if (!chk.ok) {
              try {
                await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "ooc.invalid", reason: chk.reason, details: (chk as any).details, ooc: sanitizeForLog(ooc) }, status: "WARN", type: "OOC_INVALID" });
              } catch {}
              try { await sendRoleTabs(); } catch {}
              continue;
            }

            const intentRaw: string = String(ooc.intent || "");
            const canonical = aliasToCanonical(intentRaw);
            const flowId = canonicalToFlowId(sessRole, canonical);
            // Route to role-specific handlers
            const to = toGraphPhone(phoneE164);
            const display = replyText.replace(/<<?OOC>[\s\S]*?<\/OOC>>>/g, "").trim();
            try {
              if (sessRole === "supervisor") await handleSupervisorAction(auth.sess, flowId, phoneE164);
              else if (sessRole === "supplier") await handleSupplierAction(auth.sess, flowId, phoneE164);
              else await handleAuthenticatedInteractive(auth.sess, flowId);
            } catch {}
            if (display) {
              try { await sendText(to, display, "AI_DISPATCH_TEXT"); } catch {}
            } else {
              // Avoid silence when GPT returns an empty display; send a clarifier if tabs are disabled
              if (!TABS_ENABLED) {
                try { await sendText(to, "I didn't quite get that.", "AI_DISPATCH_TEXT"); } catch {}
              }
            }
            try { await sendRoleTabs(); } catch {}
            try { await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, meta: { phoneE164, intent: flowId } }, status: "OK", type: "GPT_ROUTE_SUCCESS" }); } catch {}
            continue;

            // FREE_TEXT or other → send clarifier with full role tabs
            try { await sendRoleTabs(); } catch {}
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
                  await sendSixTabs(to, (role as any) || "attendant", auth.sess?.outlet || undefined);
                  await logOutbound({ direction: "out", templateName: null, payload: { in_reply_to: wamid, event: "intent.unresolved", phone: phoneE164, text }, status: "SENT", type: "INTENT_UNRESOLVED" });
                  continue;
                }
              }

              // GPT attempt with timeout and single retry; empty response falls back to menu
              const reply = await runGptForIncoming(phoneE164, text);
              const r = String(reply || "").trim();
              if (r) {
                // Try to parse OOC from the tail of the message
                const ooc = (() => {
                  try {
                    const start = r.lastIndexOf("<<<OOC>");
                    const end = r.lastIndexOf("</OOC>>>");
                    if (start >= 0 && end > start) {
                      const jsonPart = r.substring(start + 7, end).trim();
                      const parsed = JSON.parse(jsonPart);
                      return parsed;
                    }
                  } catch {}
                  return null;
                })();

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
                  if (!recent) {
                    await logOutbound({ direction: "in", payload: { type: "LOGIN_PROMPT", phone: phoneE164, reason: "unauth.ooc" }, status: "LOGIN_PROMPT", type: "WARN" });
                    await promptWebLogin(phoneE164, "unauth");
                  }
                  continue;
                }

                // Missing/invalid OOC → treat as FREE_TEXT and fall back to menu
                const intent = String(ooc?.intent || "").toUpperCase();
                if (!ooc || !intent) {
                  const role = String(auth.sess?.role || "attendant");
                  const to = toGraphPhone(phoneE164);
                  await sendSixTabs(to, (role as any) || "attendant", auth.sess?.outlet || undefined);
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
                    await sendText(toGraphPhone(phoneE164), r, "AI_DISPATCH_TEXT");
                    await logOutbound({ direction: "out", templateName: null, payload: { in_reply_to: wamid, phone: phoneE164, meta: { phoneE164, ooc } }, status: "SENT", type: "AI_DISPATCH_TEXT" });
                    continue;
                  }
                }

                // Default: just send the GPT text and fall back to menu if vague
                await sendText(toGraphPhone(phoneE164), r, "AI_DISPATCH_TEXT");
                await logOutbound({ direction: "out", templateName: null, payload: { in_reply_to: wamid, phone: phoneE164 }, status: "SENT", type: "AI_DISPATCH_TEXT" });
                continue;
              } else {
                const role = String(auth.sess?.role || "attendant");
                const to = toGraphPhone(phoneE164);
                await sendSixTabs(to, (role as any) || "attendant", auth.sess?.outlet || undefined);
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
            // Always follow with tabs menu for role (six tabs)
            try { await sendSixTabs(toGraphPhone(phoneE164), (sessRole as any) || "attendant", auth.sess?.outlet || undefined); } catch {}
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
              await sendText(to, "I can only read text and button replies for now.", "AI_DISPATCH_TEXT");
            }
            await sendSixTabs(to, (sessRole as any) || "attendant", auth.sess?.outlet || undefined);
            await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneE164, event: "fallback.unknown_type", type }, status: "INFO", type: "FALLBACK_UNKNOWN" });
          } catch {}
        }
      }
    }
  } catch (e: any) {
    await logOutbound({ direction: "in", payload: { error: e?.message || String(e) }, status: "ERROR" });
  }

  return NextResponse.json({ ok: true });
}
