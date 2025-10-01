// Thin wrappers that adapt the existing lib flow to the new webhook surface.
import { prisma } from "@/lib/db";
import { handleInboundText as libHandleInboundText, handleInteractiveReply as libHandleInteractiveReply } from "@/lib/wa_attendant_flow";

const TTL_MIN = Number(process.env.WA_SESSION_TTL_MIN || 10);

export async function ensureAuthenticated(phoneE164: string): Promise<
  | { ok: true; sess: any }
  | { ok: false; reason: "no-session" | "logged-out" | "expired" }
> {
  const sess = await (prisma as any).waSession.findUnique({ where: { phoneE164 } });
  if (!sess) return { ok: false, reason: "no-session" };

  const hasCreds = !!(sess.code);
  const isLoginish = sess.state === "LOGIN" || sess.state === "SPLASH";
  if (!hasCreds || isLoginish) return { ok: false, reason: "logged-out" };

  const updatedAt = new Date(sess.updatedAt).getTime();
  const maxIdle = TTL_MIN * 60 * 1000;
  if (Date.now() - updatedAt > maxIdle) {
    try {
      await (prisma as any).waSession.update({ where: { id: sess.id }, data: { state: "LOGIN" } });
    } catch {}
    return { ok: false, reason: "expired" };
  }

  return { ok: true, sess };
}

export async function handleAuthenticatedText(sess: any, text: string) {
  const phone = sess?.phoneE164 || "";
  if (!phone) return;
  await libHandleInboundText(phone, text);
}

export async function handleAuthenticatedInteractive(sess: any, id: string) {
  const phone = sess?.phoneE164 || "";
  if (!phone || !id) return;
  // Adapt to lib signature by creating an interactive-like payload
  await libHandleInteractiveReply(phone, { button_reply: { id, title: id } });
}
