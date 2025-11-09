import { computeAmountToDepositCurrent } from "@/server/deposit_metrics";
import { isGeneralDepositAttendant } from "@/server/general_deposit";
import { prisma } from "@/lib/prisma";
import { sendTextSafe } from "@/lib/wa";

// WhatsApp helper for special general-deposit attendants.
// Sends a prompt with the required deposit amount and a deep link to trigger STK immediately.
// Rate-limited per attendant per day.

const RATE_LIMIT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes between prompts
const MAX_PROMPTS_PER_DAY = 6; // safety cap

async function getTodayISO(): Promise<string> {
  const d = new Date();
  const tzOffset = '+03:00'; // Nairobi fixed; adjust if multi-TZ needed later
  return new Date(d.getTime() + (d.getTimezoneOffset() * -60000)).toISOString().slice(0,10); // calendar date
}

async function recordPrompt(attendantCode: string) {
  try {
    const key = `general_deposit_prompt:${await getTodayISO()}:${attendantCode.toUpperCase()}`;
    const existing = await (prisma as any).setting.findUnique({ where: { key } }).catch(()=>null);
    const now = Date.now();
    let arr: number[] = [];
    if (existing && existing.value && Array.isArray(existing.value)) arr = existing.value as number[];
    arr.push(now);
    if (arr.length > MAX_PROMPTS_PER_DAY) arr = arr.slice(-MAX_PROMPTS_PER_DAY);
    if (existing) {
      await (prisma as any).setting.update({ where: { key }, data: { value: arr } });
    } else {
      await (prisma as any).setting.create({ data: { key, value: arr } });
    }
  } catch {}
}

async function canSendPrompt(attendantCode: string): Promise<boolean> {
  try {
    const key = `general_deposit_prompt:${await getTodayISO()}:${attendantCode.toUpperCase()}`;
    const row = await (prisma as any).setting.findUnique({ where: { key } }).catch(()=>null);
    const now = Date.now();
    let arr: number[] = [];
    if (row && row.value && Array.isArray(row.value)) arr = row.value as number[];
    if (arr.length >= MAX_PROMPTS_PER_DAY) return false;
    const last = arr.length ? arr[arr.length - 1] : 0;
    if (last && (now - last) < RATE_LIMIT_WINDOW_MS) return false;
    return true;
  } catch {
    return true; // fail-open
  }
}

function buildDeepLink(opts: { attendantCode: string; outletCode: string; amount: number; phone: string }): string {
  // Link points to /api/pay/stk with mode=GENERAL_DEPOSIT; consumer (browser) can fetch to trigger STK.
  const base = process.env.PUBLIC_BASE_URL || "";
  const u = new URL(base || "http://localhost:3000");
  u.pathname = "/api/pay/stk";
  u.searchParams.set("outletCode", opts.outletCode);
  u.searchParams.set("phone", opts.phone);
  u.searchParams.set("amount", String(Math.round(opts.amount)));
  u.searchParams.set("mode", "GENERAL_DEPOSIT");
  u.searchParams.set("attendantCode", opts.attendantCode);
  u.searchParams.set("accountRef", `DEP_${opts.attendantCode.toUpperCase()}`);
  u.searchParams.set("description", "Deposit for general items");
  return u.toString();
}

export async function sendGeneralDepositPrompt(opts: { attendantCode: string; outletName: string; phoneE164: string }) {
  const code = String(opts.attendantCode || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'attendantCode required' };
  const isSpecial = await isGeneralDepositAttendant(code);
  if (!isSpecial) return { ok: false, error: 'not-special-attendant' };
  const can = await canSendPrompt(code);
  if (!can) return { ok: false, error: 'rate-limited' };
  const metrics = await computeAmountToDepositCurrent({ outletName: opts.outletName, attendantCode: code });
  const outstanding = Math.max(0, metrics.amountToDeposit || 0);
  if (outstanding <= 0) return { ok: false, error: 'no-outstanding' };
  const link = buildDeepLink({ attendantCode: code, outletCode: opts.outletName, amount: outstanding, phone: opts.phoneE164.replace(/^\+/, '') });
  const text = `You need to deposit KSh ${Math.round(outstanding)} for GENERAL items today. Tap to deposit now:\n${link}`;
  const sendRes = await sendTextSafe(opts.phoneE164, text, 'AI_DISPATCH_TEXT');
  if (sendRes.ok) await recordPrompt(code);
  return { ok: sendRes.ok, amount: outstanding, waMessageId: (sendRes as any).waMessageId, link };
}
