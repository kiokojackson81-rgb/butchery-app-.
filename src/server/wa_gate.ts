import { createLoginLink } from "@/server/wa_links";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { toGraphPhone } from "@/server/canon";

export async function promptWebLogin(phoneE164: string, reason?: string) {
  const { url } = await createLoginLink(phoneE164);
  // Route via centralized dispatcher; it will handle 24h reopen and composition
  await sendOpsMessage(phoneE164, { kind: "login_prompt", reason });
}
