import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendText } from "@/lib/wa";
import { canonFull, toE164DB } from "@/server/canon";
import { sendAttendantMenu, sendSupervisorMenu, sendSupplierMenu } from "@/lib/wa_menus";

function msSince(iso?: string) {
  if (!iso) return Infinity;
  return Date.now() - new Date(iso).getTime();
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { phoneE164, nonce, role, code, outlet } = (await req.json()) as {
      phoneE164: string; nonce: string; role: string; code: string; outlet?: string | null;
    };
    if (!phoneE164 || !nonce || !role || !code) {
      return NextResponse.json({ ok: false, error: "missing params" }, { status: 400 });
    }

    const phoneDB = toE164DB(phoneE164);
    const codeFull = canonFull(code);

    const sess = await (prisma as any).waSession.findFirst({ where: { phoneE164: phoneDB } });
    if (!sess) return NextResponse.json({ ok: false, error: "no-session" }, { status: 404 });

    const cur = (sess.cursor as any) || {};
    const tooOld = msSince(cur.loginNonceAt) > 15 * 60_000; // 15 min
    if (cur.loginNonce !== nonce || tooOld) {
      return NextResponse.json({ ok: false, error: "invalid-or-expired-nonce" }, { status: 400 });
    }

    // Guard: ensure code exists/active and role matches
    const pc = await (prisma as any).personCode.findUnique({ where: { code: codeFull } });
    if (!pc || !pc.active || String(pc.role) !== String(role)) {
      return NextResponse.json({ ok: false, error: "invalid_code" }, { status: 400 });
    }

    // Upsert phone mapping (strict: one phone per code)
    await (prisma as any).phoneMapping.upsert({
      where: { code: codeFull },
      update: { role, phoneE164: phoneDB, outlet: outlet ?? null },
      create: { code: codeFull, role, phoneE164: phoneDB, outlet: outlet ?? null },
    });

    await (prisma as any).waSession.update({
      where: { id: sess.id },
      data: {
        role,
        code: codeFull,
        outlet: outlet ?? null,
        state: "MENU",
        cursor: { ...cur, loginNonce: null, loginNonceAt: null, lastActiveAt: new Date().toISOString() } as any,
      },
    });

    const to = String(phoneDB || '').replace(/^\+/, "");
    await sendText(to, "Login successful. What would you like to do?");
    if (role === "attendant") await sendAttendantMenu(to, outlet || "your outlet");
    else if (role === "supervisor") await sendSupervisorMenu(to);
    else await sendSupplierMenu(to);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server error" }, { status: 500 });
  }
}
