import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull } from "@/server/canon";
import { findPersonCodeTolerant } from "@/server/db_person";
import { sendText } from "@/lib/wa";
import { sendAttendantMenu, sendSupervisorMenu, sendSupplierMenu } from "@/lib/wa_menus";

function msSince(iso?: string) {
  if (!iso) return Infinity;
  return Date.now() - new Date(iso).getTime();
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;


function toE164DB(phone: string): string {
  // Assume incoming is already +E.164; store as-is
  return String(phone || "");
}

export async function POST(req: Request) {
  try {
    const { phoneE164, nonce, code } = (await req.json()) as {
      phoneE164: string; nonce: string; code: string;
    };
    if (!phoneE164 || !nonce || !code) {
      return NextResponse.json({ ok: false, error: "missing params" }, { status: 400 });
    }

  const phoneDB = toE164DB(phoneE164);
  const full = canonFull(code);

  const sess = await (prisma as any).waSession.findFirst({ where: { phoneE164: phoneDB } });
    if (!sess) return NextResponse.json({ ok: false, error: "no-session" }, { status: 404 });

    const cur = (sess.cursor as any) || {};
    const tooOld = msSince(cur.loginNonceAt) > 15 * 60_000; // 15 min
    if (cur.loginNonce !== nonce || tooOld) {
      return NextResponse.json({ ok: false, error: "invalid-or-expired-nonce" }, { status: 400 });
    }

    // Resolve PersonCode tolerantly
    const pc = await findPersonCodeTolerant(full);
    if (!pc) return NextResponse.json({ ok: false, error: "Invalid code" }, { status: 401 });

    // Lookup role-specific and compute outlet if attendant
    const role = pc.role as string;
    let outletFinal: string | null = null;
    if (role === "attendant") {
      const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: full } });
      outletFinal = scope?.outletName ?? null;
      if (!outletFinal) return NextResponse.json({ ok: false, error: "Attendant not assigned to outlet" }, { status: 422 });
    }

    // Upsert phone mapping by phone (so same phone updates binding)
    await (prisma as any).phoneMapping.upsert({
      where: { phoneE164: phoneDB },
      update: { code: pc.code, role, outlet: outletFinal ?? null },
      create: { phoneE164: phoneDB, code: pc.code, role, outlet: outletFinal ?? null },
    });

    await (prisma as any).waSession.update({
      where: { id: sess.id },
      data: {
  role,
  code: pc.code,
  outlet: outletFinal ?? null,
        state: "MENU",
        cursor: { ...cur, loginNonce: null, loginNonceAt: null, lastActiveAt: new Date().toISOString() } as any,
      },
    });

    const to = String(phoneDB || '').replace(/^\+/, "");
    await sendText(to, "Login successful. What would you like to do?");
  if (role === "attendant") await sendAttendantMenu(to, outletFinal || "your outlet");
    else if (role === "supervisor") await sendSupervisorMenu(to);
    else await sendSupplierMenu(to);

  return NextResponse.json({ ok: true, role, code: pc.code, outlet: outletFinal, phoneE164: phoneDB, nonce });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server error" }, { status: 500 });
  }
}
