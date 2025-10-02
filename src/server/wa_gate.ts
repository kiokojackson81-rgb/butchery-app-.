import { createLoginLink } from "@/server/wa_links";
import { sendText, sendInteractive } from "@/lib/wa";
import { toGraphPhone, toE164DB } from "@/server/canon";

export async function promptWebLogin(phoneE164: string, reason?: string) {
  const { url } = await createLoginLink(phoneE164);
  const msg = `To continue, tap to log in:\n${url}`;
  const toGraph = toGraphPhone(phoneE164);
  await sendText(toGraph, msg);
  await sendInteractive({
    to: toGraph,
    type: "button",
    body: { text: "Need the login link again?" },
    action: {
      buttons: [
        { type: "reply", reply: { id: "open_login", title: "Send login link" } },
        { type: "reply", reply: { id: "help", title: "Help" } },
      ],
    },
  });
}
