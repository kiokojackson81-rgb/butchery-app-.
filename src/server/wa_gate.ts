import { createLoginLink } from "@/server/wa_links";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { toGraphPhone } from "@/server/canon";
import { shouldDebounce, markLastMsg } from "@/lib/waSession";
import { sendText, sendTextSafe } from "@/lib/wa";

export async function promptWebLogin(phoneE164: string, reason?: string) {
  const { url } = await createLoginLink(phoneE164);
  // Debounce duplicates within 15s
  if (await shouldDebounce(phoneE164, "login_prompt", 15_000)) {
    // Still send a lightweight hint to avoid silence
    try {
      const origin = process.env.APP_ORIGIN || "https://barakafresh.com";
      const link = url || `${origin}/login`;
  const to = toGraphPhone(phoneE164);
  await sendTextSafe(to, `You're not logged in. Open ${link} to continue.`, "AI_DISPATCH_TEXT");
    } catch {}
    return;
  }
  // Route via centralized dispatcher; it will handle 24h reopen and composition
  await sendOpsMessage(phoneE164, { kind: "login_prompt", reason });
  await markLastMsg(phoneE164, "login_prompt");
}
