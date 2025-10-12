import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull, canonNum } from "@/lib/codeNormalize";
import { finalizeLoginDirect } from "@/app/api/wa/auth/finalize/route";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { findPersonCodeTolerant } from "@/server/db_person";
import { logOutbound } from "@/lib/wa";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

function businessDeepLink(): string | null {
  const num = (process.env.NEXT_PUBLIC_WA_PUBLIC_E164 || "").replace(/[^0-9]/g, "");
  if (!num) return null;
  return `https://wa.me/${num}`;
}

export async function POST(req: Request) {
  try {
    const { code, src, wa } = (await req.json().catch(() => ({}))) as { code?: string; src?: string; wa?: string };
    const full = canonFull(code || "");
    const num = canonNum(code || "");
    if (!full && !num) return NextResponse.json({ ok: false, code: "INVALID_CODE", message: "Invalid code" }, { status: 400 });

    // 1) Try tolerant DB match (active-only)
    let pc: any = await findPersonCodeTolerant(full).catch((e:any) => { if (/ambiguous/i.test(String(e?.message))) throw Object.assign(new Error("AMBIGUOUS_CODE"), { code: "AMBIGUOUS_CODE" }); return null; });

    // 2) If not found, fall back to Settings.admin_codes mirror and re-sync DB to avoid stale inactive rows
    if (!pc) {
      try {
        const row = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
        const list: any[] = Array.isArray((row as any)?.value) ? (row as any).value : [];
        const active = list.filter((p: any) => !!p?.active);
        let person = active.find((p: any) => canonFull(p?.code || "") === full);
        if (!person && num) {
          const matches = active.filter((p: any) => canonNum(p?.code || "") === num);
          if (matches.length === 1) person = matches[0];
          else if (matches.length > 1) throw Object.assign(new Error("AMBIGUOUS_CODE"), { code: "AMBIGUOUS_CODE" });
        }
        if (person) {
          const pcCode = canonFull(person.code || full);
          const pcRole = String(person.role || "attendant").toLowerCase();
          const existing = await (prisma as any).personCode.findUnique({ where: { code: pcCode } }).catch(() => null);
          if (existing) {
            await (prisma as any).personCode.update({ where: { code: pcCode }, data: { role: pcRole, name: person?.name || existing?.name || null, active: true } });
          } else {
            await (prisma as any).personCode.create({ data: { code: pcCode, role: pcRole, name: person?.name || null, active: true } });
          }
          // Re-query via tolerant helper to keep single source of truth
          pc = await findPersonCodeTolerant(pcCode).catch(() => null);
        }
      } catch {}
    }

    if (!pc) return NextResponse.json({ ok: false, code: "INVALID_CODE", message: "That code wasn’t found or is inactive. Check with Admin." }, { status: 404 });

    const role = String(pc.role || "attendant");
    let outlet: string | null = null;
    if (role === "attendant") {
      const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: pc.code } });
      outlet = scope?.outletName ?? null;
      if (!outlet) return NextResponse.json({ ok: false, code: "CODE_NOT_ASSIGNED", message: "Your outlet is not set. Ask Supervisor to assign your outlet." }, { status: 422 });
    }

    // If wa phone provided, attempt direct finalize and bind
    if (wa) {
      try { await logOutbound({ direction: "in", payload: { event: "login.page.submit", code: full || num, phone_guess: wa }, status: "INFO" }); } catch {}
      const fin = await finalizeLoginDirect(wa, pc.code);
      if (!(fin as any)?.ok) {
        // fall back to creating a pending session for webhook to finalize on first inbound
        await (prisma as any).waSession.upsert({
          where: { phoneE164: `+PENDING:${pc.code}` },
          update: { role, code: pc.code, outlet, state: "LOGIN", cursor: { issuedAt: Date.now() } },
          create: { phoneE164: `+PENDING:${pc.code}`, role, code: pc.code, outlet, state: "LOGIN", cursor: { issuedAt: Date.now() } },
        }).catch(() => {});
      } else {
        // Finalize already triggered safeSendGreetingOrMenu. Avoid double-send here.
        try { await logOutbound({ direction: "in", payload: { event: "login.finalize.ok", phone: wa, role, outlet }, status: "INFO", type: "LOGIN_FINALIZE_OK" }); } catch {}
      }
    } else {
      // No wa phone provided: create or refresh pending session for webhook
      await (prisma as any).waSession.upsert({
        where: { phoneE164: `+PENDING:${pc.code}` },
        update: { role, code: pc.code, outlet, state: "LOGIN", cursor: { issuedAt: Date.now() } },
        create: { phoneE164: `+PENDING:${pc.code}`, role, code: pc.code, outlet, state: "LOGIN", cursor: { issuedAt: Date.now() } },
      }).catch(() => {});
    }

  const link = businessDeepLink();
    if (!link) return NextResponse.json({ ok: false, code: "CONFIG", message: "WhatsApp not configured" }, { status: 500 });
    return NextResponse.json({ ok: true, role, outlet, waDeepLink: link });
  } catch (e: any) {
    const code = (e as any)?.code || "GENERIC";
    if (code === "AMBIGUOUS_CODE") return NextResponse.json({ ok: false, code, message: "Multiple codes share those digits. Enter the full code (letters + numbers)." }, { status: 409 });
    return NextResponse.json({ ok: false, code: "GENERIC", message: "We couldn’t log you in. Try again or contact Admin." }, { status: 500 });
  }
}
