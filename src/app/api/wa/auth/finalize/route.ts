import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCode, canonNum } from "@/lib/codeNormalize";
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
    const { phoneE164, nonce, role, code, outlet } = (await req.json()) as {
      phoneE164: string; nonce: string; role: string; code: string; outlet?: string | null;
    };
    if (!phoneE164 || !nonce || !role || !code) {
      return NextResponse.json({ ok: false, error: "missing params" }, { status: 400 });
    }

  const phoneDB = toE164DB(phoneE164);
  const full = normalizeCode(code);
  const num = canonNum(code);

  const sess = await (prisma as any).waSession.findFirst({ where: { phoneE164: phoneDB } });
    if (!sess) return NextResponse.json({ ok: false, error: "no-session" }, { status: 404 });

    const cur = (sess.cursor as any) || {};
    const tooOld = msSince(cur.loginNonceAt) > 15 * 60_000; // 15 min
    if (cur.loginNonce !== nonce || tooOld) {
      return NextResponse.json({ ok: false, error: "invalid-or-expired-nonce" }, { status: 400 });
    }

    // Find code via LoginCode using same tolerant rules
    let row: any = await (prisma as any).loginCode.findFirst({ where: { code: full } });
    if (!row && num) {
      const list: any[] = await (prisma as any).$queryRawUnsafe(
        `SELECT * FROM "LoginCode" WHERE regexp_replace(code, '\\D', '', 'g') = ${num} LIMIT 3`
      );
      if (list.length === 1) row = list[0];
      else if (list.length > 1) return NextResponse.json({ ok: false, error: "Ambiguous code (multiple matches)" }, { status: 409 });
    }
    if (!row) return NextResponse.json({ ok: false, error: "Invalid code" }, { status: 401 });

    // Lookup role-specific and compute outlet if attendant
    let outletFinal: string | null = outlet ?? null;
    if (role === "attendant" && !outletFinal) {
      const att = await (prisma as any).attendant.findFirst({ where: { loginCode: { equals: row.code, mode: "insensitive" } } });
      outletFinal = att?.outletId || null;
      if (!outletFinal) return NextResponse.json({ ok: false, error: "Attendant not assigned to outlet" }, { status: 422 });
    }

    // Upsert phone mapping by phone (so same phone updates binding)
    await (prisma as any).phoneMapping.upsert({
      where: { phoneE164: phoneDB },
      update: { code: row.code, role, outlet: outletFinal ?? null },
      create: { phoneE164: phoneDB, code: row.code, role, outlet: outletFinal ?? null },
    });

    await (prisma as any).waSession.update({
      where: { id: sess.id },
      data: {
  role,
  code: row.code,
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

  return NextResponse.json({ ok: true, role, code: row.code, outlet: outletFinal, phoneE164: phoneDB, nonce });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server error" }, { status: 500 });
  }
}
