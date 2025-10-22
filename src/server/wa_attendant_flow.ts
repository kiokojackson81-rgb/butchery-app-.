// Thin wrappers that adapt the existing lib flow to the new webhook surface.
import { prisma } from "@/lib/prisma";
import { getDrySession as getDrySess, setDrySession as setDrySess } from "@/lib/dev_dry";
import { handleInboundText as libHandleInboundText, handleInteractiveReply as libHandleInteractiveReply } from "@/lib/wa_attendant_flow";

const TTL_MIN = Number(process.env.WA_SESSION_TTL_MIN || 10);

export async function ensureAuthenticated(phoneE164: string): Promise<
  | { ok: true; sess: any }
  | { ok: false; reason: "no-session" | "logged-out" | "expired" }
> {
  // DRY-mode: avoid hitting the database to prevent long connection timeouts in local/dev.
  try {
    const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
    if (DRY) {
      const dry = getDrySess(phoneE164);
      // If the in-memory DRY session is already in a login-like state, treat it as unauthenticated
      if (dry && (String(dry.state || "").toUpperCase() === "LOGIN" || String(dry.state || "").toUpperCase() === "SPLASH")) {
        return { ok: false, reason: "expired" } as any;
      }
      if (dry) {
        return { ok: true, sess: { phoneE164, role: dry.role || "attendant", code: dry.code || "ATT001", outlet: dry.outlet || "TestOutlet", state: dry.state || "MENU", cursor: dry.cursor || { date: new Date().toISOString().slice(0,10), rows: [], status: "ACTIVE" }, updatedAt: new Date() } } as any;
      }
      // Create a minimal in-memory session for tests
      const cursor = { date: new Date().toISOString().slice(0,10), rows: [], status: "ACTIVE" } as any;
      try { setDrySess({ phoneE164, role: "attendant", code: "ATT001", outlet: "TestOutlet", state: "MENU", cursor }); } catch {}
      return { ok: true, sess: { phoneE164, role: "attendant", code: "ATT001", outlet: "TestOutlet", state: "MENU", cursor, updatedAt: new Date() } } as any;
    }
  } catch {}

  let sess = await (prisma as any).waSession.findUnique({ where: { phoneE164 } });

  // Auto-recover: if session missing or lacks credentials, try binding from phoneMapping
  // Strict mode: disable auto-recover to force explicit login
  const STRICT = String(process.env.WA_STRICT_AUTH || "true").toLowerCase() === "true";
  const needsRecover = !sess || !sess.code || sess.state === "LOGIN" || sess.state === "SPLASH";
  if (needsRecover && !STRICT) {
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
  // Explicitly treat LOGGED_OUT as unauthenticated
  if (sess.state === "LOGGED_OUT") return { ok: false, reason: "logged-out" };
  // Race guard: if we finalized very recently, treat as authenticated to avoid a login loop
  try {
    const lastFin = (sess as any).lastFinalizeAt ? new Date((sess as any).lastFinalizeAt).getTime() : 0;
    if (lastFin && Date.now() - lastFin < 20_000 && hasCreds) {
      return { ok: true, sess };
    }
  } catch {}
  // Strong signal from finalize: only treat ACTIVE as authenticated if not expired by TTL
  const isCursorActive = Boolean((sess?.cursor as any)?.status === "ACTIVE");
  if (hasCreds && isCursorActive) {
    const updatedAt = new Date(sess.updatedAt).getTime();
    const maxIdle = TTL_MIN * 60 * 1000;
    if (Date.now() - updatedAt <= maxIdle) {
      return { ok: true, sess };
    }
  }
  if (!hasCreds || isLoginish) return { ok: false, reason: "logged-out" };
  // If we're about to return unauthenticated but the record shows credentials
  // there can be a small race between finalize/upsert and the incoming webhook.
  // Do a single short re-read with a tiny backoff to reduce false negatives.
  try {
    const shouldRetry = hasCreds && !isCursorActive;
    if (shouldRetry) {
      // Wait a short moment for any concurrent finalize/upsert to land.
      await new Promise((r) => setTimeout(r, 200));
      const fresh = await (prisma as any).waSession.findUnique({ where: { phoneE164 } }).catch(() => null);
      if (fresh) {
        sess = fresh;
        const freshHasCreds = !!fresh.code;
        const freshCursorActive = Boolean((fresh?.cursor as any)?.status === "ACTIVE");
        if (freshHasCreds && freshCursorActive) return { ok: true, sess: fresh };
      }
    }
  } catch {}

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

export async function handleAuthenticatedInteractive(sess: any, id: string): Promise<boolean> {
  const phone = sess?.phoneE164 || "";
  if (!phone || !id) return false;
  try {
    // Adapt to lib signature by creating an interactive-like payload
    return await libHandleInteractiveReply(phone, { button_reply: { id, title: id } });
  } catch (err) {
    console.error("handleAuthenticatedInteractive failed", err);
    return false;
  }
}
