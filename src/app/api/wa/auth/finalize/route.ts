import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull, toE164DB, toGraphPhone } from "@/server/canon";
import { findPersonCodeTolerant } from "@/server/db_person";
import { sendText, warmUpSession } from "@/lib/wa";
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
  const pc = await findPersonCodeTolerant(full);
  if (!pc) return { ok: false, error: "INVALID_CODE" } as const;
  if (pc.active === false) return { ok: false, error: "INACTIVE" } as const;

  const role = String(pc.role || "attendant");
  let outletFinal: string | null = null;
  if (role === "attendant") {
    const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: pc.code } });
    outletFinal = scope?.outletName ?? null;
    if (!outletFinal) return { ok: false, error: "CODE_NOT_ASSIGNED" } as const;
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

  // Refresh session to MENU
  try {
    const prev = await (prisma as any).waSession.findFirst({ where: { phoneE164: phoneDB } });
    if (prev) {
      await (prisma as any).waSession.update({ where: { id: prev.id }, data: { role, code: pc.code, outlet: outletFinal, state: "MENU", cursor: { lastActiveAt: new Date().toISOString() } as any } });
    } else {
      await (prisma as any).waSession.create({ data: { phoneE164: phoneDB, role, code: pc.code, outlet: outletFinal, state: "MENU", cursor: { lastActiveAt: new Date().toISOString() } as any } });
    }
  } catch {}

  const to = toGraphPhone(phoneDB);
  try { await warmUpSession(to); } catch {}
  // Welcome copy per spec (role-specific menu follows)
  try { await sendText(to, "Login successful. What would you like to do?"); } catch {}
  try {
    if (role === "attendant") await sendAttendantMenu(to, outletFinal || "your outlet");
    else if (role === "supervisor") await sendSupervisorMenu(to);
    else await sendSupplierMenu(to);
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
