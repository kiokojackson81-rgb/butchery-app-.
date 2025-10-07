import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull, toE164DB, toGraphPhone } from "@/server/canon";
import { findPersonCodeTolerant } from "@/server/db_person";
import { sendText, warmUpSession, logOutbound } from "@/lib/wa";
import { markLastMsg, touchWaSession } from "@/lib/waSession";
import { sendAttendantMenu, sendSupervisorMenu, sendSupplierMenu } from "@/lib/wa_menus";

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
    let scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: pc.code } });
    outletFinal = scope?.outletName ?? null;
    if (!outletFinal) {
      if (!DRY) return { ok: false, error: "CODE_NOT_ASSIGNED" } as const;
      // DRY-only: auto-create a scope assignment for tests
      try {
        scope = await (prisma as any).attendantScope.create({ data: { codeNorm: pc.code, outletName: "Test Outlet" } });
        outletFinal = scope.outletName;
        // DRY-only: ensure a couple of sample products and attach to scope
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
    const prev = await (prisma as any).waSession.findFirst({ where: { phoneE164: phoneDB } });
    if (prev) {
      await (prisma as any).waSession.update({ where: { id: prev.id }, data: { role, code: pc.code, outlet: outletFinal, state: "MENU", cursor: { lastActiveAt: new Date().toISOString(), tradingPeriodId, status: "ACTIVE" } as any } });
    } else {
      await (prisma as any).waSession.create({ data: { phoneE164: phoneDB, role, code: pc.code, outlet: outletFinal, state: "MENU", cursor: { lastActiveAt: new Date().toISOString(), tradingPeriodId, status: "ACTIVE" } as any } });
    }
  } catch {}

  const to = toGraphPhone(phoneDB);
  try { await warmUpSession(to); } catch {}
  // Welcome copy per spec (role-specific menu follows)
  try { await sendText(to, "Login successful. What would you like to do?", "AI_DISPATCH_TEXT"); } catch {}
  try {
    if (role === "attendant") await sendAttendantMenu(to, outletFinal || "your outlet");
    else if (role === "supervisor") await sendSupervisorMenu(to);
    else await sendSupplierMenu(to);
  } catch {}

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
    const result = await finalizeLoginDirect(phoneE164, code);
    const status = (result as any)?.ok ? 200 : 400;
    return NextResponse.json(result as any, { status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server error" }, { status: 500 });
  }
}
