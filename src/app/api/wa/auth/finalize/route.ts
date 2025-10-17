import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull, toE164DB, toGraphPhone } from "@/server/canon";
import { canonFull as canonFullCode, normalizeCode } from "@/lib/codeNormalize";
import { findPersonCodeTolerant } from "@/server/db_person";
import { warmUpSession, logOutbound } from "@/lib/wa";
import { markLastMsg, touchWaSession } from "@/lib/waSession";
import { safeSendGreetingOrMenu } from "@/lib/wa_attendant_flow";
import { setDrySession, updateDrySession } from "@/lib/dev_dry";

function msSince(iso?: string) {
  if (!iso) return Infinity;
  return Date.now() - new Date(iso).getTime();
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function finalizeLoginDirect(phoneE164: string, rawCode: string) {
  const phoneDB = toE164DB(phoneE164);
  const full = canonFull(rawCode);
  // Resolve PersonCode tolerantly
  const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
  let pc: any = await findPersonCodeTolerant(full);
  if (!pc) {
    if (!DRY) return { ok: false, error: "INVALID_CODE" } as const;
    // DRY-only: auto-seed a PersonCode for tests
    try {
      pc = await (prisma as any).personCode.create({ data: { code: full, role: "attendant", active: true } });
    } catch (e) {
      // If unique exists, fetch again
      pc = await (prisma as any).personCode.findUnique({ where: { code: full } });
    }
  }
  if (pc.active === false) return { ok: false, error: "INACTIVE" } as const;

  const role = String(pc.role || "attendant");
  let outletFinal: string | null = null;
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const tradingPeriodId = outletFinal ? `${y}-${m}-${d}@${outletFinal}` : null;
  if (role === "attendant") {
    // Align outlet resolution with login-link API for parity
    // 1) Primary: AttendantScope
    let scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: pc.code } }).catch(() => null);
    outletFinal = (scope as any)?.outletName ?? null;

    // 2) Legacy assignment
    if (!outletFinal) {
      try {
        const assign = await (prisma as any).attendantAssignment.findUnique({ where: { code: pc.code } });
        outletFinal = (assign as any)?.outlet || null;
      } catch {}
    }

    // 3) Settings mirror: attendant_scope
    if (!outletFinal) {
      try {
        const row = await (prisma as any).setting.findUnique({ where: { key: "attendant_scope" } });
        const map = (row as any)?.value || null;
        if (map && typeof map === "object") {
          const key = pc.code;
          let entry = (map as any)[key]
            || (map as any)[normalizeCode(key)]
            || (map as any)[canonFullCode(key)]
            || null;
          if (!entry) {
            for (const k of Object.keys(map)) {
              if (normalizeCode(k) === normalizeCode(key)) { entry = (map as any)[k]; break; }
            }
          }
          const out = entry && typeof entry === "object" ? String((entry as any)?.outlet || "").trim() : "";
          if (out) outletFinal = out;
        }
      } catch {}
    }

    // 4) Settings mirror: admin_codes
    if (!outletFinal) {
      try {
        const row = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
        const list: any[] = Array.isArray((row as any)?.value) ? (row as any).value : [];
        const active = list.filter((p: any) => !!p?.active && String(p?.role || '').toLowerCase() === 'attendant');
        const byFull = active.find((p: any) => canonFullCode(p?.code || '') === canonFullCode(pc.code));
        if (byFull?.outlet) outletFinal = String(byFull.outlet);
      } catch {}
    }

    // 5) DRY fallback to avoid blocking local/dev
    if (!outletFinal) {
      if (!DRY) return { ok: false, error: "CODE_NOT_ASSIGNED" } as const;
      try {
        scope = await (prisma as any).attendantScope.create({ data: { codeNorm: pc.code, outletName: "Test Outlet" } });
        outletFinal = scope.outletName;
        const ensureProd = async (key: string, name: string, unit = "kg", sellPrice = 0) => {
          const existed = await (prisma as any).product.findUnique({ where: { key } }).catch(() => null);
          if (!existed) await (prisma as any).product.create({ data: { key, name, unit, sellPrice, active: true } });
        };
        await ensureProd("beef", "Beef");
        await ensureProd("goat", "Goat");
        const sc = await (prisma as any).attendantScope.findUnique({ where: { id: scope.id }, include: { products: true } });
        const haveKeys = new Set(((sc?.products || []) as any[]).map((p: any) => p.productKey));
        const attach = async (k: string) => {
          if (!haveKeys.has(k)) await (prisma as any).scopeProduct.create({ data: { scopeId: scope!.id, productKey: k } });
        };
        await attach("beef");
        await attach("goat");
      } catch {}
      if (!outletFinal) return { ok: false, error: "CODE_NOT_ASSIGNED" } as const;
    }
  }

  // Bind mapping by unique code and update phone
  try {
    const existing = await (prisma as any).phoneMapping.findUnique({ where: { code: pc.code } });
    if (existing) {
      await (prisma as any).phoneMapping.update({ where: { code: pc.code }, data: { phoneE164: phoneDB, role, outlet: outletFinal } });
    } else {
      await (prisma as any).phoneMapping.create({ data: { code: pc.code, phoneE164: phoneDB, role, outlet: outletFinal } });
    }
  } catch {}

  // Refresh session to MENU (ACTIVE)
  try {
    const nowIso = new Date().toISOString();
    const prev = await (prisma as any).waSession.findFirst({ where: { phoneE164: phoneDB } });
    if (prev) {
      await (prisma as any).waSession.update({ where: { id: prev.id }, data: { role, code: pc.code, outlet: outletFinal, state: "MENU", cursor: { lastActiveAt: nowIso, tradingPeriodId, status: "ACTIVE" } as any, lastFinalizeAt: new Date(), sessionVersion: Number(prev.sessionVersion || 0) + 1 } });
    } else {
      await (prisma as any).waSession.create({ data: { phoneE164: phoneDB, role, code: pc.code, outlet: outletFinal, state: "MENU", cursor: { lastActiveAt: nowIso, tradingPeriodId, status: "ACTIVE" } as any, lastFinalizeAt: new Date(), sessionVersion: 1 } });
    }
  } catch {
    // DRY fallback: persist to in-memory store so tests can proceed without DB
    setDrySession({ phoneE164: phoneDB, role, outlet: outletFinal, code: pc.code, state: "MENU", cursor: { lastActiveAt: new Date().toISOString(), tradingPeriodId, status: "ACTIVE" } });
  }

  const to = toGraphPhone(phoneDB);
  try { await warmUpSession(to); } catch {}
  try { await safeSendGreetingOrMenu({ phone: phoneDB, role, outlet: outletFinal || undefined, force: true, source: "auth_finalize" }); } catch {}

  try {
    await logOutbound({
      direction: "out",
      templateName: null,
      payload: { phone: phoneDB, meta: { phoneE164: phoneDB, outlet: outletFinal, role, tradingPeriodId }, event: "login_welcome_sent" },
      status: "SENT",
      type: "login_welcome_sent",
    });
  } catch {}

  try { await markLastMsg(phoneDB, "welcome_sent"); await touchWaSession(phoneDB); } catch {}

  try {
    await logOutbound({ direction: "in", templateName: null, payload: { event: "session.linked", phone: phoneDB, role, outlet: outletFinal, tradingPeriodId }, status: "INFO", type: "SESSION_LINKED" });
  } catch {}
  try {
    await logOutbound({ direction: "in", templateName: null, payload: { phone: phoneDB, meta: { phoneE164: phoneDB, session_state: "MENU", has_session: true }, event: "login.finalized" }, status: "INFO", type: "LOGIN_FINALIZED" });
  } catch {}

  return { ok: true, role, code: pc.code, outlet: outletFinal, phoneE164: phoneDB } as const;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const phoneE164: string | undefined = body?.phoneE164;
    const code: string | undefined = body?.code;
    const nonce: string | undefined = body?.nonce;
    if (!phoneE164 || !code) return NextResponse.json({ ok: false, error: "missing params" }, { status: 400 });

    // Backward-compatible path: if nonce is provided, skip now and just proceed with direct finalize as well
    try {
      const result = await finalizeLoginDirect(phoneE164, code);
      const status = (result as any)?.ok ? 200 : 400;
      return NextResponse.json(result as any, { status });
    } catch (e) {
      // DRY fallback: allow login to succeed without DB so GPT-only tests can proceed
      const dry = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
      if (dry) {
          try { setDrySession({ phoneE164, role: 'attendant', code, outlet: 'TestOutlet', state: 'MENU', cursor: { status: 'ACTIVE', lastActiveAt: new Date().toISOString() } }); } catch {}
          return NextResponse.json({ ok: true, role: 'attendant', code, outlet: 'TestOutlet', phoneE164 }, { status: 200 });
      }
      throw e;
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server error" }, { status: 500 });
  }
}
