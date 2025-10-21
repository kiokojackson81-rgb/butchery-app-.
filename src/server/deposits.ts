// src/server/deposits.ts
import { prisma } from "@/lib/prisma";
import { recordDryDeposit } from "@/lib/dev_dry";
import { getAccessToken, darajaPost } from "@/lib/daraja";
import { notifyAttendants, notifySupplier } from "@/server/supervisor/supervisor.notifications";
import { computeDayTotals } from "@/server/finance";

// Config: enable automatic Daraja verification via env
// For safety, require an explicit opt-in to auto-verification. Default: force manual approval.
const FORCE_MANUAL_DEPOSITS = String(process.env.FORCE_MANUAL_DEPOSITS || "true").toLowerCase() === "true";
const DARAJA_VERIFY_ENABLED = String(process.env.DARAJA_VERIFY_ENABLED || "").toLowerCase() === "true";
const DARAJA_VERIFY_STUB = String(process.env.DARAJA_VERIFY_STUB || "").toLowerCase() === "true";
// Optional path for verification endpoint, if your Daraja setup expects a custom path
const DARAJA_VERIFY_PATH = process.env.DARAJA_VERIFY_PATH || "";

export function parseMpesaText(s: string): { amount: number; ref: string; at: Date; meta?: { currency?: string; payee?: string; channel?: "TILL"|"PAYBILL"|"PERSON"|"UNKNOWN" } } | null {
  if (!s) return null;
  const t = String(s);
  // Common patterns:
  // - "Confirmed. Ksh1,250.00 sent to Till 123456 ... REF"
  // - "Ksh 3,500.00 confirmed. QWERTY1234Z"
  // - Variants: KES|KSh|Ksh; reference codes ~10-12 alphanum
  // Strategy:
  // 1) Find a reference code token
  // 2) Find the first currency amount NOT tied to "balance" context
  // 3) Try to detect payee/channel for UI hints

  // Reference code
  const refMatch = /\b([A-Z0-9]{10,12})\b/.exec(t);
  const ref = refMatch?.[1] || null;

  // Amount tokens with currency
  // Capture multiple then pick the first not followed by 'balance' nearby
  const amtRegex = /(KSH|KSh|Ksh|KES|Kes|kes)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/g;
  let amount: number | null = null;
  let currency: string | undefined;
  const LOWER = t.toLowerCase();
  const candidates: Array<{ idx: number; curr: string; raw: string }> = [];
  for (const m of t.matchAll(amtRegex)) {
    const idx = m.index ?? 0;
    const curr = m[1];
    const raw = m[2];
    candidates.push({ idx, curr, raw });
  }
  for (const c of candidates) {
    // If within 20 chars of "balance", skip (likely the balance line)
    const window = LOWER.slice(c.idx, c.idx + 40);
    if (window.includes("balance")) continue;
    const n = Number(String(c.raw).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) { amount = n; currency = c.curr.toUpperCase(); break; }
  }
  // Fallback: if all were balance-tagged, take the first
  if (amount == null && candidates.length) {
    const c = candidates[0];
    const n = Number(String(c.raw).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) { amount = n; currency = c.curr.toUpperCase(); }
  }

  if (!ref || !amount) return null;

  // Payee/channel hints
  let channel: "TILL"|"PAYBILL"|"PERSON"|"UNKNOWN" = "UNKNOWN";
  if (/\btill\b/i.test(t)) channel = "TILL";
  else if (/\bpay\s*bill\b/i.test(t)) channel = "PAYBILL";
  else if (/\bto\s+[A-Za-z]/i.test(t)) channel = "PERSON";

  let payee: string | undefined;
  const toMatch = /\bto\s+([A-Za-z][A-Za-z0-9\s.&-]{1,40})\b/i.exec(t);
  if (toMatch) payee = toMatch[1].trim();

  return { amount, ref, at: new Date(), meta: { currency, payee, channel } };
}

export async function addDeposit(args: { date?: string; outletName: string; amount: number; note?: string; code?: string }) {
  const date = args.date || new Date().toISOString().slice(0, 10);
  // Idempotent create: prefer DB, but fall back to DRY store when unavailable
  try {
    const existing = await (prisma as any).attendantDeposit.findFirst({ where: { date, outletName: args.outletName, amount: args.amount, note: args.note || null } });
    if (existing) {
      // If existing but not yet VALID, attempt verification if enabled
      if (existing.status !== "VALID") {
        try {
          const v = await tryAutoVerifyDeposit({ amount: args.amount, ref: args.note, outlet: args.outletName });
          if (v.verified) {
            // persist short verification summary in note for auditability (no schema change)
            const existingNote = (existing as any).note || "";
            const verSummary = buildVerifySummary(v.payload);
            const newNote = `${existingNote}${existingNote ? ' ' : ''}${verSummary}`.slice(0, 1000);
            await (prisma as any).attendantDeposit.update({ where: { id: (existing as any).id }, data: { status: "VALID", note: newNote, verifyPayload: v.payload } });
            // Notify attendants/supplier similar to supervisor VALID flow
            try {
              await notifyAttendants(args.outletName, `Deposit VALID: KSh ${args.amount} (${args.note || "ref"})`);
              await notifySupplier(args.outletName, `Deposit VALID for ${args.outletName}: KSh ${args.amount}`);
            } catch {}
            // Trigger a lightweight recompute of day totals to refresh any caches/metrics
            try { void computeDayTotals({ date, outletName: args.outletName }); } catch {}
            return { ...(existing as any), status: "VALID", note: newNote } as any;
          }
        } catch (e) {
          // ignore verification errors; leave pending
        }
      }
      return existing;
    }

    // Create deposit with PENDING first; we'll attempt verification after write
    const created = await (prisma as any).attendantDeposit.create({ data: { date, outletName: args.outletName, amount: args.amount, note: args.note || null, status: "PENDING", createdAt: new Date() } });

    // Try automatic verification (best-effort). If verified, mark VALID.
    try {
      const v = await tryAutoVerifyDeposit({ amount: args.amount, ref: args.note, outlet: args.outletName });
      if (v.verified) {
        try {
          // persist short verification summary in note for auditability
          const existingNote = (created as any).note || "";
          const verSummary = buildVerifySummary(v.payload);
          const newNote = `${existingNote}${existingNote ? ' ' : ''}${verSummary}`.slice(0, 1000);
          await (prisma as any).attendantDeposit.update({ where: { id: (created as any).id }, data: { status: "VALID", note: newNote, verifyPayload: v.payload } });
          // Notify attendants/supplier similar to supervisor VALID flow
          try {
            await notifyAttendants(args.outletName, `Deposit VALID: KSh ${args.amount} (${args.note || "ref"})`);
            await notifySupplier(args.outletName, `Deposit VALID for ${args.outletName}: KSh ${args.amount}`);
          } catch {}
          // Trigger a lightweight recompute of day totals to refresh any caches/metrics
          try { void computeDayTotals({ date, outletName: args.outletName }); } catch {}
          // return updated object
          return { ...(created as any), status: "VALID", note: newNote } as any;
        } catch {}
      }
    } catch (e) {
      // verification failed or unavailable; keep pending
    }
    return created;
  } catch {
    // DRY/dev: store in memory so TXNS view works in tests
    recordDryDeposit({ outletName: args.outletName, date, amount: args.amount, note: args.note });
    return { date, outletName: args.outletName, amount: args.amount, note: args.note || null, status: "RECORDED", createdAt: new Date() } as any;
  }
}

async function tryAutoVerifyDeposit(opts: { amount: number; ref?: string | null; outlet?: string }) : Promise<{ verified: boolean; payload?: any }> {
  // Safety: if FORCE_MANUAL_DEPOSITS is true, skip auto-verification entirely (manual admin approval required)
  if (FORCE_MANUAL_DEPOSITS) {
    try { console.info('[deposits] FORCE_MANUAL_DEPOSITS enabled: skipping auto-verification (manual approval required)'); } catch {}
    return { verified: false, payload: { reason: 'force_manual' } };
  }

  // Quick stub / env gated verification:
  if (DARAJA_VERIFY_STUB) {
    try { console.info('[deposits] DARAJA_VERIFY_STUB enabled: auto-verify true'); } catch {}
    return { verified: true, payload: { stub: true } };
  }
  // If verification explicitly disabled, skip
  if (!DARAJA_VERIFY_ENABLED) return { verified: false, payload: { reason: 'disabled' } };
  const ref = String(opts.ref || "").trim();
  if (!ref) return { verified: false, payload: { reason: 'no-ref' } };

  // If a custom verify path is provided, call it; otherwise skip (safe default)
  if (!DARAJA_VERIFY_PATH) {
    try { console.warn('[deposits] DARAJA_VERIFY_ENABLED true but DARAJA_VERIFY_PATH not configured - skipping automatic verification'); } catch {}
    return { verified: false, payload: { reason: 'no-path' } };
  }

  try {
    const token = await getAccessToken();
    // Caller must provide DARAJA_VERIFY_PATH to a compatible endpoint that accepts { ref } and returns { ok:true, amount?:number }
    const body = { ref, amount: Number(opts.amount || 0) };
    const res = await darajaPost(DARAJA_VERIFY_PATH, token, body).catch((e:any) => { throw e; });
    // Expected response shape: { ok: boolean, amount?: number }
    if (res && (res.ok === true || Number(res.amount) === Number(opts.amount || 0))) return { verified: true, payload: res };
    return { verified: false, payload: res };
  } catch (e: any) {
    try { console.warn('[deposits] auto verification failed', String(e)); } catch {}
    return { verified: false, payload: { error: String(e) } };
  }
}

function buildVerifySummary(payload: any) {
  try {
    if (!payload) return '';
    if (payload.stub) return '[auto-verified:stub]';
    if (payload.ok) return `[auto-verified]`;
    if (payload.amount) return `[verify amt:${payload.amount}]`;
    if (payload.error) return `[verify err:${String(payload.error).slice(0,60)}]`;
    return `[verify:${JSON.stringify(payload).slice(0,80)}]`;
  } catch {
    return '';
  }
}
