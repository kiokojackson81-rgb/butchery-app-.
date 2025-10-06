import { prisma } from "@/lib/prisma";

export type WaSession = {
  phone: string; // E.164
  role: "attendant" | "supplier" | "supervisor" | "admin" | null;
  code: string | null;
  outlet?: string | null;
  period?: "active" | "locked";
  token?: string | null;
  lastActive: number; // ms epoch
  expiresAt: number; // ms epoch
  cursor?: any;
};

const TTL_MIN = Number(process.env.WA_SESSION_TTL_MIN || 60);

function nowMs() { return Date.now(); }
function toE164(phone: string) { return phone.startsWith("+") ? phone : "+" + phone.replace(/[^0-9+]/g, ""); }

export async function getWaSession(phone: string): Promise<WaSession | null> {
  const e164 = toE164(phone);
  const row = await (prisma as any).waSession.findUnique({ where: { phoneE164: e164 } }).catch(() => null);
  if (!row) return null;
  const lastActive = new Date(row.updatedAt as Date).getTime();
  const expiresAt = lastActive + TTL_MIN * 60_000;
  return {
    phone: row.phoneE164,
    role: row.role,
    code: row.code,
    outlet: row.outlet,
    token: (row.cursor as any)?.token ?? null,
    period: (row.cursor as any)?.period ?? "active",
    lastActive,
    expiresAt,
    cursor: row.cursor,
  };
}

export async function putWaSession(s: WaSession): Promise<void> {
  const e164 = toE164(s.phone);
  const data: any = {
    role: s.role,
    code: s.code,
    outlet: s.outlet ?? null,
    state: (s.cursor?.state || "MENU"),
    cursor: {
      ...(s.cursor || {}),
      token: s.token || (s.cursor?.token ?? null),
      period: s.period || s.cursor?.period || "active",
    },
  };
  const existing = await (prisma as any).waSession.findUnique({ where: { phoneE164: e164 } }).catch(() => null);
  if (existing) await (prisma as any).waSession.update({ where: { id: existing.id }, data });
  else await (prisma as any).waSession.create({ data: { phoneE164: e164, role: s.role || "attendant", ...data } });
}

export async function clearWaSession(phone: string): Promise<void> {
  const e164 = toE164(phone);
  try { await (prisma as any).waSession.update({ where: { phoneE164: e164 }, data: { code: null, outlet: null, state: "LOGIN" } }); } catch {}
}

export async function touchWaSession(phone: string): Promise<void> {
  const e164 = toE164(phone);
  try { await (prisma as any).waSession.update({ where: { phoneE164: e164 }, data: { updatedAt: new Date() } }); } catch {}
}

export async function markLastMsg(phone: string, type: string): Promise<void> {
  const e164 = toE164(phone);
  try {
    const s = await (prisma as any).waSession.findUnique({ where: { phoneE164: e164 } });
    const cursor = Object.assign({}, (s?.cursor || {}));
    cursor.lastMsgType = type;
    cursor.lastMsgAt = new Date().toISOString();
    await (prisma as any).waSession.update({ where: { phoneE164: e164 }, data: { cursor } });
  } catch {}
}

export async function shouldDebounce(phone: string, type: string, windowMs = 15_000): Promise<boolean> {
  const e164 = toE164(phone);
  try {
    const s = await (prisma as any).waSession.findUnique({ where: { phoneE164: e164 } });
    const c: any = s?.cursor || {};
    if (c.lastMsgType !== type) return false;
    const at = c.lastMsgAt ? new Date(c.lastMsgAt).getTime() : 0;
  return Boolean(at) && nowMs() - at < windowMs;
  } catch { return false; }
}
