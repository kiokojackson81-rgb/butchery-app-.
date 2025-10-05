import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { finalizeLoginDirect } from "@/app/api/wa/auth/finalize/route";
import { findPersonCodeTolerant } from "@/server/db_person";
import { canonFull } from "@/server/canon";
import { sendTemplate } from "@/lib/wa";
import { WA_TEMPLATES } from "@/server/wa/templates";

// Expose the public, dialable WA number we send users to.
const WA_PUBLIC_E164 = process.env.NEXT_PUBLIC_WA_PUBLIC_E164?.replace(/^\+/, ""); // e.g. 254107651410

// Return business chat target (no prefilled text as per spec)
function businessChatTargets() {
  const waMe = `https://wa.me/${WA_PUBLIC_E164}`;
  const ios = `whatsapp://send?phone=${WA_PUBLIC_E164}`;
  return { waMe, ios };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    if (!WA_PUBLIC_E164) {
      return NextResponse.json({ ok: false, error: "Missing NEXT_PUBLIC_WA_PUBLIC_E164" }, { status: 500 });
    }

    const { code, waPhone } = (await req.json()) as { code?: string; waPhone?: string };
    const raw = String(code || "").trim();
    const full = canonFull(raw);

    // Resolve person tolerantly and classify errors
    let pc: any = null;
    try {
      pc = await findPersonCodeTolerant(full);
    } catch (err: any) {
      // ambiguous
      const targets = businessChatTargets();
      const app = process.env.APP_ORIGIN || "";
      // Best-effort failure notify
      const to = waPhone || null;
  if (to) { try { await sendTemplate({ to, template: WA_TEMPLATES.loginFailure, params: ["", `${app}/login`], contextType: "LOGIN_FAIL" }); } catch {} }
      return NextResponse.json({ ok: false, code: "AMBIGUOUS_CODE", targets }, { status: 409 });
    }

    if (!pc) {
      const targets = businessChatTargets();
      const app = process.env.APP_ORIGIN || "";
      const to = waPhone || null;
  if (to) { try { await sendTemplate({ to, template: WA_TEMPLATES.loginFailure, params: ["", `${app}/login`], contextType: "LOGIN_FAIL" }); } catch {} }
      return NextResponse.json({ ok: false, code: "INVALID_CODE", targets }, { status: 404 });
    }

    if (pc.active === false) {
      const targets = businessChatTargets();
      const app = process.env.APP_ORIGIN || "";
      const to = waPhone || null;
  if (to) { try { await sendTemplate({ to, template: WA_TEMPLATES.loginFailure, params: ["", `${app}/login`], contextType: "LOGIN_FAIL" }); } catch {} }
      return NextResponse.json({ ok: false, code: "INACTIVE", targets }, { status: 403 });
    }

    // Compute outlet if attendant (to validate assignment)
    let outletFinal: string | null = null;
    if (String(pc.role) === "attendant") {
      const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: pc.code } });
      outletFinal = scope?.outletName ?? null;
      if (!outletFinal) {
        const targets = businessChatTargets();
        const app = process.env.APP_ORIGIN || "";
        const to = waPhone || null;
  if (to) { try { await sendTemplate({ to, template: WA_TEMPLATES.loginFailure, params: ["", `${app}/login`], contextType: "LOGIN_FAIL" }); } catch {} }
        return NextResponse.json({ ok: false, code: "CODE_NOT_ASSIGNED", targets }, { status: 422 });
      }
    }

    // Determine phone to bind: prefer waPhone, else existing mapping
    let phoneToBind: string | null = waPhone || null;
    if (!phoneToBind) {
      const pm = await (prisma as any).phoneMapping.findUnique({ where: { code: pc.code } }).catch(() => null);
      phoneToBind = pm?.phoneE164 || null;
    }

    if (!phoneToBind) {
      // Still proceed; finalize will create session without sending failure
      const targets = businessChatTargets();
      return NextResponse.json({ ok: true, role: pc.role, outlet: outletFinal, toE164: WA_PUBLIC_E164, targets }, { status: 200 });
    }

    const fin = await finalizeLoginDirect(phoneToBind, pc.code);
    const targets = businessChatTargets();
    const status = (fin as any)?.ok ? 200 : 400;
    return NextResponse.json({ ...(fin as any), toE164: WA_PUBLIC_E164, targets }, { status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server error" }, { status: 500 });
  }
}
