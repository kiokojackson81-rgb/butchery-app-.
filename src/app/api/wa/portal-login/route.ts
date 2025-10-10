import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { warmUpSession } from "@/lib/wa";
import { safeSendGreetingOrMenu } from "@/lib/wa_attendant_flow";
import { normCode, toGraphPhone, toDbPhone } from "@/server/util/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const RATE = new Map<string, { count: number; ts: number }>();
function rateLimit(key: string, max = 30, windowMs = 60_000) {
  const now = Date.now();
  const s = RATE.get(key);
  if (!s || now - s.ts > windowMs) {
    RATE.set(key, { count: 1, ts: now });
    return true;
  }
  s.count++;
  s.ts = now;
  if (s.count <= max) return true;
  return false;
}

function looksLikeCode(code: string) {
  return /^[A-Za-z0-9]{3,10}$/.test(code);
}

export async function POST(req: Request) {
  try {
    const { code } = await req.json();
    const key = `portal:${req.headers.get("x-forwarded-for") || "ip"}:${code || ""}`;
    if (!rateLimit(key, 30, 60_000)) {
      return NextResponse.json({ ok: false, reason: "RATE_LIMIT" }, { status: 429 });
    }

  const c = normCode(String(code || ""));
    if (!looksLikeCode(c)) {
      return NextResponse.json({ ok: false, reason: "INVALID_CODE" }, { status: 400 });
    }

    // 1) PersonCode
    const pc = await (prisma as any).personCode.findFirst({ where: { code: { equals: c, mode: "insensitive" }, active: true } });
    if (!pc || !pc.active) {
      return NextResponse.json({ ok: false, reason: "INVALID_CODE" }, { status: 404 });
    }
    const role = pc.role as string; // 'attendant'|'supervisor'|'supplier'

    // 2) PhoneMapping for this code
  const mapping = await (prisma as any).phoneMapping.findUnique({ where: { code: pc.code } });

    // 3) Determine outlet if possible
    let outlet = mapping?.outlet || null;
    if (!outlet && role === "attendant") {
      const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: pc.code } });
      outlet = scope?.outletName || null;
    }

    // 4) If phone bound => create/update WaSession & send menu immediately
    if (mapping?.phoneE164) {
      const phonePlus = mapping.phoneE164; // +E.164 in DB
      // For non-production or dry-run, our WA transport won't hit Graph, but we still normalize to graph format safely.
      const phoneGraph = phonePlus.replace(/^\+/, "");

      await (prisma as any).waSession.upsert({
        where: { phoneE164: phonePlus },
        update: { role, code: pc.code, outlet, state: "MENU", cursor: { date: new Date().toISOString().slice(0, 10), rows: [] } },
        create: { phoneE164: phonePlus, role, code: pc.code, outlet, state: "MENU", cursor: { date: new Date().toISOString().slice(0, 10), rows: [] } },
      });

      try { await warmUpSession(phoneGraph); } catch {}
      try {
        await safeSendGreetingOrMenu({
          phone: phonePlus,
          role: (role as any) || "attendant",
          outlet,
          source: "portal_login_bound",
          sessionLike: { outlet },
        });
      } catch {}

      return NextResponse.json({ ok: true, bound: true, waBusiness: process.env.NEXT_PUBLIC_WA_BUSINESS || null });
    }

    // 5) Unbound => issue a LINK token stored in session cursor
    const token = "LINK " + String(Math.floor(100000 + Math.random() * 900000));
    await (prisma as any).waSession.upsert({
      where: { phoneE164: `+PENDING:${pc.code}` },
      update: { role, code: pc.code, outlet, state: "LOGIN", cursor: { linkToken: token, issuedAt: Date.now() } },
      create: { phoneE164: `+PENDING:${pc.code}`, role, code: pc.code, outlet, state: "LOGIN", cursor: { linkToken: token, issuedAt: Date.now() } },
    });

    return NextResponse.json({ ok: true, bound: false, token, waBusiness: process.env.NEXT_PUBLIC_WA_BUSINESS || null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, reason: "SERVER", error: e?.message }, { status: 200 });
  }
}
