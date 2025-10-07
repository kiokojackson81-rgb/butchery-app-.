// Thin wrappers that adapt the existing lib flow to the new webhook surface.
import { prisma } from "@/lib/prisma";
import { handleInboundText as libHandleInboundText, handleInteractiveReply as libHandleInteractiveReply } from "@/lib/wa_attendant_flow";

const TTL_MIN = Number(process.env.WA_SESSION_TTL_MIN || 120);

export async function ensureAuthenticated(phoneE164: string): Promise<
  | { ok: true; sess: any }
  | { ok: false; reason: "no-session" | "logged-out" | "expired" }
> {
  let sess = await (prisma as any).waSession.findUnique({ where: { phoneE164 } });

  // Auto-recover: if session missing or lacks credentials, try binding from phoneMapping
  const needsRecover = !sess || !sess.code || sess.state === "LOGIN" || sess.state === "SPLASH";
  if (needsRecover) {
    try {
      // phoneE164 is not unique in PhoneMapping; use findFirst
      const pm = await (prisma as any).phoneMapping.findFirst({ where: { phoneE164 } }).catch(() => null);
      if (pm?.code) {
        const pc = await (prisma as any).personCode.findFirst({ where: { code: pm.code, active: true } }).catch(() => null);
        if (pc) {
          let outlet: string | null = pm.outlet || null;
          if (!outlet && String(pc.role || "attendant").toLowerCase() === "attendant") {
            const sc = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: pc.code } }).catch(() => null);
            outlet = sc?.outletName || null;
          }
          const cursor = (sess?.cursor as any) || { date: new Date().toISOString().slice(0, 10), rows: [] };
          await (prisma as any).waSession.upsert({
            where: { phoneE164 },
            update: { role: pc.role, code: pc.code, outlet, state: "MENU", cursor },
            create: { phoneE164, role: pc.role, code: pc.code, outlet, state: "MENU", cursor },
          });
          sess = await (prisma as any).waSession.findUnique({ where: { phoneE164 } });
        }
      }
    } catch {}
  }

  if (!sess) return { ok: false, reason: "no-session" };

  const hasCreds = !!(sess.code);
  const isLoginish = sess.state === "LOGIN" || sess.state === "SPLASH";
  // Strong signal from finalize: if cursor.status === "ACTIVE" and we have creds, treat as authenticated
  const isCursorActive = Boolean((sess?.cursor as any)?.status === "ACTIVE");
  if (hasCreds && isCursorActive) {
    return { ok: true, sess };
  }
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
