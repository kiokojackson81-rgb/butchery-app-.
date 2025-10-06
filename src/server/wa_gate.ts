import { createLoginLink } from "@/server/wa_links";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { toGraphPhone } from "@/server/canon";
import { shouldDebounce, markLastMsg } from "@/lib/waSession";

export async function promptWebLogin(phoneE164: string, reason?: string) {
  const { url } = await createLoginLink(phoneE164);
  // Debounce duplicates within 15s
  if (await shouldDebounce(phoneE164, "login_prompt", 15_000)) return;
  // Route via centralized dispatcher; it will handle 24h reopen and composition
  await sendOpsMessage(phoneE164, { kind: "login_prompt", reason });
  await markLastMsg(phoneE164, "login_prompt");
}
