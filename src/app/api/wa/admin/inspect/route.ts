import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTextSafe, sendInteractiveSafe, sendTemplate } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normPhone(raw: string | null) {
  if (!raw) return { e164: null, noPlus: null };
  const digits = raw.replace(/[^0-9+]/g, "").replace(/^\+?/, "");
  if (!digits) return { e164: null, noPlus: null };
  return { e164: "+" + digits, noPlus: digits };
}

async function recentLogs(limit = 50) {
  try {
    const rows = await (prisma as any).$queryRawUnsafe(
      `SELECT id, "createdAt", direction, status, type, "templateName", payload::text AS payload
       FROM "WaMessageLog" ORDER BY "createdAt" DESC LIMIT $1`,
      limit
    );
    return rows;
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const phone = String(searchParams.get("phone") || "");
    const { e164, noPlus } = normPhone(phone || null as any);

    // Quick env flags
    const { hasPhoneNumberId, hasToken } = await import('@/lib/whatsapp/config');
    const env = {
      NODE_ENV: process.env.NODE_ENV || null,
      WA_DRY_RUN: String(process.env.WA_DRY_RUN || "").toLowerCase() === "true",
      WA_AUTOSEND_ENABLED: String(process.env.WA_AUTOSEND_ENABLED || "").toLowerCase() === "true",
      WA_INTERACTIVE_ENABLED: String(process.env.WA_INTERACTIVE_ENABLED || "").toLowerCase() === "true",
      WA_GPT_ONLY: String(process.env.WA_GPT_ONLY || "").toLowerCase() === "true",
      WA_TABS_ENABLED: String(process.env.WA_TABS_ENABLED || "").toLowerCase() === "true",
      WA_AI_ENABLED: String(process.env.WA_AI_ENABLED || "true").toLowerCase() === "true",
      OPENAI_KEY_PRESENT: !!process.env.OPENAI_API_KEY,
      WHATSAPP_TOKEN_PRESENT: hasToken(),
      WHATSAPP_PHONE_NUMBER_ID_PRESENT: hasPhoneNumberId(),
      WHATSAPP_WARMUP_TEMPLATE: process.env.WHATSAPP_WARMUP_TEMPLATE || null,
      WA_TEMPLATE_NAME_BALANCE: process.env.WA_TEMPLATE_NAME_BALANCE || null,
      WA_TEMPLATE_NAME_HIGH_VALUE: process.env.WA_TEMPLATE_NAME_HIGH_VALUE || null,
      WA_TEMPLATE_NAME_MIDNIGHT: process.env.WA_TEMPLATE_NAME_MIDNIGHT || null,
    };

    // Recent logs
    const logs = await recentLogs(Number(searchParams.get("limit") || 50));

    // Session + mapping lookups
    let sessions: any[] = [];
    let mappings: any[] = [];
    if (e164) {
      try {
        sessions = await (prisma as any).waSession.findMany({ where: { OR: [{ phoneE164: e164 }, { phoneE164: noPlus as any }] }, take: 10, orderBy: { updatedAt: 'desc' } }).catch(() => []);
      } catch {}
      try {
        mappings = await (prisma as any).phoneMapping.findMany({ where: { OR: [{ phoneE164: e164 }, { phoneE164: noPlus as any }] }, take: 10, orderBy: { updatedAt: 'desc' } }).catch(() => []);
      } catch {}
    }

    return NextResponse.json({ ok: true, env, logs, sessions, mappings });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

// POST: trigger a guarded test send or a GPT dry-run lookup
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const keyRequired = process.env.NODE_ENV === 'production' && !!process.env.ADMIN_DIAG_KEY;
    if (keyRequired) {
      const key = String(new URL(req.url).searchParams.get('key') || '');
      if (!key || key !== process.env.ADMIN_DIAG_KEY) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }
    const phone = String(body.phone || body.to || "");
    if (!phone) return NextResponse.json({ ok: false, error: 'missing phone' }, { status: 400 });
    const to = phone.startsWith('+') ? phone : ('+' + phone.replace(/[^0-9]/g, ''));

    const kind = String(body.kind || 'text');
    const text = String(body.text || 'Diagnostic test message from admin');

    // 'gpt' kind no longer supported

    if (kind === 'template') {
      const tmpl = String(body.template || process.env.WA_TEMPLATE_OPS_ROLE_NOTICE || 'ops_role_notice');
      try {
        const explicitParamsRaw = (body as any).params ?? (body as any).bodyParams ?? null;
        const explicitParams = Array.isArray(explicitParamsRaw) ? explicitParamsRaw.map((x: any) => String(x ?? '')) : null;

        const wantsParams = String(tmpl).toLowerCase().includes('_v1');
        const params = explicitParams
          ? explicitParams
          : (wantsParams
              ? [String(body.p1 || 'BarakaOps needs your attention'), String(body.p2 || (process.env.APP_ORIGIN || 'https://barakafresh.com') + '/login')]
              : []);
        const res = await sendTemplate({ to, template: tmpl, params, contextType: 'TEMPLATE_REOPEN' });
        return NextResponse.json({ ok: true, result: res });
      } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }); }
    }

    if (kind === 'interactive') {
      // send a small button interactive
      const bodyPayload = {
        messaging_product: 'whatsapp',
        to: to.replace(/^\+/, ''),
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: text.slice(0, 300) },
          action: { buttons: [ { type: 'reply', reply: { id: 'TEST_1', title: 'OK' } }, { type: 'reply', reply: { id: 'TEST_2', title: 'HELP' } } ] }
        }
      };
      const res = await sendInteractiveSafe(bodyPayload as any, 'AI_DISPATCH_INTERACTIVE');
      return NextResponse.json({ ok: true, kind: 'interactive', result: res });
    }

    // default: text
    const res = await sendTextSafe(to.replace(/^\+/, ''), text, 'AI_DISPATCH_TEXT');
    return NextResponse.json({ ok: true, kind: 'text', result: res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
