import { createLoginLink } from "@/server/wa_links";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { toGraphPhone } from "@/server/canon";
import { shouldDebounce, markLastMsg } from "@/lib/waSession";
import { sendTextSafe } from "@/lib/wa";

// Send a single login prompt (debounced) with deep link; avoid multiple fallbacks
export async function promptWebLogin(phoneE164: string, reason?: string) {
  // If we've sent recently, do nothing (silence is acceptable to prevent spam)
  if (await shouldDebounce(phoneE164, "login_prompt", 15_000)) return;
  // Mark immediately to avoid race where multiple callers send concurrently
  await markLastMsg(phoneE164, "login_prompt");

  const origin = process.env.APP_ORIGIN || "https://barakafresh.com";
  let link: string;
  try { link = (await createLoginLink(phoneE164)).url || origin + "/login"; } catch { link = origin + "/login"; }

  // Try centralized dispatcher first for reopen/template logic
  let dispatched: any = null;
  try { dispatched = await sendOpsMessage(phoneE164, { kind: "login_prompt", reason } as any); } catch { dispatched = null; }

  // Only fallback if dispatcher failed entirely
  if (!dispatched || dispatched.ok === false) {
    const to = toGraphPhone(phoneE164);
    try { await sendTextSafe(to, `You're not logged in. Open ${link} to continue.`, "AI_DISPATCH_TEXT", { gpt_sent: true }); } catch {}
  }
}
