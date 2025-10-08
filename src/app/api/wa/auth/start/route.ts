import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { canonFull, canonNum } from "@/lib/codeNormalize";
import { normalizeToPlusE164, toGraphPhone } from "@/lib/wa_phone";
import { sendText, logOutbound, warmUpSession } from "@/lib/wa";
import { sendAttendantMenu, sendSupplierMenu, sendSupervisorMenu } from "@/lib/wa_menus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const APP_ORIGIN = process.env.APP_ORIGIN || "https://barakafresh.com";

async function resolveCode(raw: string): Promise<
  | { ok: true; role: "attendant" | "supervisor" | "supplier"; code: string; name?: string | null; outlet?: string | null; products: string[] }
  | { ok: false; reason: "invalid" | "ambiguous" | "inactive" }
> {
  const full = canonFull(raw || "");
  const num = canonNum(raw || "");
  if (!full && !num) return { ok: false, reason: "invalid" };

  const row = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
  const list: any[] = Array.isArray((row as any)?.value) ? (row as any).value : [];
  const active = list.filter((p: any) => !!p?.active);

  let person: any = active.find((p: any) => canonFull(p?.code || "") === full);
  if (!person && num) {
    const matches = active.filter((p: any) => canonNum(p?.code || "") === num);
    if (matches.length === 1) person = matches[0];
    else if (matches.length > 1) return { ok: false, reason: "ambiguous" };
  }
  if (!person) return { ok: false, reason: "invalid" };

  const role = String(person.role || "").toLowerCase();
  if (!(["attendant", "supervisor", "supplier"].includes(role))) return { ok: false, reason: "invalid" };

  let outlet: string | null = null;
  let productKeys: string[] = [];
  // Upsert PersonCode to keep DB in sync with admin_codes (prevents stale inactive rows)
    try {
      const pcCode = canonFull(person.code || full);
      const pcRole = role as any;
      const existing = await (prisma as any).personCode.findUnique({ where: { code: pcCode } });
      if (existing) {
        await (prisma as any).personCode.update({ where: { code: pcCode }, data: { role: pcRole, name: person?.name || existing.name || null, active: true } });
      } else {
        await (prisma as any).personCode.create({ data: { code: pcCode, role: pcRole, name: person?.name || null, active: true } });
      }
    } catch {}

  if (role === "attendant") {
    const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: canonFull(person.code || "") }, include: { products: true } });
    outlet = (scope as any)?.outletName || (person as any)?.outlet || null;
      productKeys = Array.isArray((scope as any)?.products) ? (scope as any).products.map((p: any) => p.productKey) : []; 
  } else {
    outlet = (person as any)?.outlet || null;
  }
  return { ok: true, role, code: canonFull(person.code || full), name: person?.name || null, outlet, products: productKeys } as any;
}

async function waLogHasNonce(phoneE164: string, nonce: string): Promise<boolean> {
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  const existing = await (prisma as any).waMessageLog.findFirst({
    where: {
      createdAt: { gt: oneMinuteAgo },
      direction: "out",
      payload: { path: ["meta", "phoneE164"], equals: phoneE164 } as any,
      AND: [{ payload: { path: ["meta", "nonce"], equals: nonce } as any }],
    },
  });
  return !!existing;
}

async function sendLoginSuccessDM(opts: { to: string; name: string; role: string; outlet: string | null; products: string[]; nonce: string }): Promise<boolean> {
  const lines = [
    `Login successful.`,
    `Hello ${opts.name}. You’re logged in as ${opts.role} for ${opts.outlet || "—"}.`,
  ];
  if (opts.role === "attendant" && opts.products?.length) {
    lines.push(`Products: ${opts.products.join(", ")}.`);
  }
  const toGraph = toGraphPhone(opts.to);
  try { await warmUpSession(toGraph); } catch {}
  const res = await sendText(toGraph, lines.join("\n"), "AI_DISPATCH_TEXT");
  // Immediately send role-specific interactive menu
  if (opts.role === "attendant") await sendAttendantMenu(toGraph, opts.outlet || "your outlet");
  else if (opts.role === "supplier") await sendSupplierMenu(toGraph);
  else await sendSupervisorMenu(toGraph);
  await logOutbound({ direction: "out", templateName: "login-success", payload: { meta: { phoneE164: opts.to, nonce: opts.nonce, tag: "login-result" } }, status: "SENT" });
  return (res as any)?.ok === true;
}

async function sendLoginFailDM(opts: { to: string; reason: string; nonce: string }): Promise<boolean> {
  const loginUrl = `${APP_ORIGIN}/login?wa=${encodeURIComponent(opts.to)}&src=wa`;
  const body = `Login unsuccessful.\nPlease verify your code and try again: ${loginUrl}\nIf it still fails, contact Admin.`;
  const toGraph = toGraphPhone(opts.to);
  const res = await sendText(toGraph, body, "AI_DISPATCH_TEXT");
  await logOutbound({ direction: "out", templateName: "login-fail", payload: { meta: { phoneE164: opts.to, nonce: opts.nonce, tag: "login-result" } }, status: "SENT" });
  return (res as any)?.ok === true;
}

export async function POST(req: Request) {
  try {
    const { code, wa, nonce: n0 } = (await req.json().catch(() => ({}))) as { code?: string; wa?: string; nonce?: string };
    const phoneE164Maybe = normalizeToPlusE164(wa || "");
    const hasPhone = !!(phoneE164Maybe && /^\+\d{10,15}$/.test(phoneE164Maybe));
    const phoneE164 = hasPhone ? phoneE164Maybe : undefined;
    const nonce = n0 || crypto.randomUUID();

    const match = await resolveCode(code || "");
    if (!match.ok) {
      let sent = false;
      const res = NextResponse.json({ ok: true, reason: match.reason, nonce, sent });
      if (hasPhone && phoneE164) {
        if (!(await waLogHasNonce(phoneE164, nonce))) {
          sent = await sendLoginFailDM({ to: phoneE164, reason: match.reason, nonce });
        }
        // cache phone for 10 minutes
        const graph = toGraphPhone(phoneE164);
        res.cookies.set("wa_click_phone", phoneE164, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
        res.cookies.set("wa_click_graph", graph, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
      }
      return NextResponse.json({ ok: true, reason: match.reason, nonce, sent });
    }

    const role = match.role;
    const codeFull = match.code;
    const outlet = match.outlet || null;
    const name = match.name || codeFull.toUpperCase();

    if (hasPhone && phoneE164) {
      await (prisma as any).phoneMapping.upsert({
        where: { code: codeFull },
        update: { role, phoneE164, outlet },
        create: { code: codeFull, role, phoneE164, outlet },
      });
    }

  const state = role === "attendant" ? "MENU" : role === "supplier" ? "SPL_MENU" : role === "supervisor" ? "SUP_MENU" : "HOME";
    const cursor: any = { date: new Date().toISOString().slice(0, 10) };
    if (hasPhone && phoneE164) {
      await (prisma as any).waSession.upsert({
        where: { phoneE164 },
        update: { role, code: codeFull, outlet, state, cursor },
        create: { phoneE164, role, code: codeFull, outlet, state, cursor },
      });
    }

    let sent = false;
    if (hasPhone && phoneE164) {
      if (!(await waLogHasNonce(phoneE164, nonce))) {
        sent = await sendLoginSuccessDM({ to: phoneE164, name, role, outlet, products: match.products || [], nonce });
      }
    }
    const res = NextResponse.json({ ok: true, nonce, sent });
    if (hasPhone && phoneE164) {
      const graph = toGraphPhone(phoneE164);
      res.cookies.set("wa_click_phone", phoneE164, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
      res.cookies.set("wa_click_graph", graph, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
    }
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
