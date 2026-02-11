import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTemplate, logOutbound, sendTextSafe } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRE_WINDOW_MINUTES = 23 * 60 + 55;
const FULL_WINDOW_MINUTES = 24 * 60;
const REMINDER_TEXT = "Hello! Please reply with \"Hi\" to keep interacting and continue receiving notifications from BarakaOps.";
const TZ = process.env.TZ_DEFAULT || "Africa/Nairobi";

type Row = { phone: string; last_in_at: string | null; template_sent: boolean; text_sent: boolean };

function minutesSince(date: string | null): number {
  if (!date) return Infinity;
  const ts = new Date(date).getTime();
  if (!Number.isFinite(ts)) return Infinity;
  return (Date.now() - ts) / 60000;
}

function nairobiDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function markReminder(type: string, phone: string, dateKey: string) {
  try {
    await (prisma as any).reminderSend.create({ data: { type, phoneE164: phone, date: dateKey } });
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    // Optional protection: require ADMIN_DIAG_KEY if set
    if (process.env.ADMIN_DIAG_KEY) {
      const key = new URL(req.url).searchParams.get("key") || req.headers.get("x-admin-key");
      if (!key || key !== process.env.ADMIN_DIAG_KEY) {
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      }
    }

    const tmpl = (process.env.WA_TEMPLATE_OPS_ROLE_NOTICE || "ops_role_notice").trim();
    const autosend = process.env.WA_AUTOSEND_ENABLED === "true";
    if (!autosend) {
      return NextResponse.json({ ok: false, error: "autosend disabled" }, { status: 200 });
    }

    const dateKey = nairobiDateKey();

    const rows = (await (prisma as any).$queryRaw`
      WITH pm AS (
        SELECT DISTINCT COALESCE("phoneE164", '') AS phone
        FROM "PhoneMapping"
        WHERE "phoneE164" IS NOT NULL
          AND "phoneE164" <> ''
          AND LOWER("role") IN ('attendant','supplier','admin','supervisor')
      ),
      last_in AS (
        SELECT COALESCE(payload->'meta'->>'phoneE164', payload->>'phone') AS phone,
               MAX("createdAt") AS last_in_at
        FROM "WaMessageLog"
        WHERE direction='in' AND "createdAt" > NOW() - INTERVAL '7 days'
        GROUP BY 1
      ),
      template_today AS (
        SELECT "phoneE164" AS phone
        FROM "ReminderSend"
        WHERE type='nightly_ping' AND date=${dateKey}
      ),
      text_today AS (
        SELECT "phoneE164" AS phone
        FROM "ReminderSend"
        WHERE type='pre24_ping' AND date=${dateKey}
      )
      SELECT pm.phone,
             li.last_in_at,
             (template_today.phone IS NOT NULL) AS template_sent,
             (text_today.phone IS NOT NULL) AS text_sent
      FROM pm
      LEFT JOIN last_in ON last_in.phone = pm.phone
      LEFT JOIN template_today ON template_today.phone = pm.phone
      LEFT JOIN text_today ON text_today.phone = pm.phone
      ORDER BY pm.phone
    `) as Row[];

    let templateSent = 0;
    let textReminders = 0;
    for (const r of rows) {
      const phone = r.phone;
      if (!phone) continue;
      const minutes = minutesSince(r.last_in_at);
      if (minutes >= FULL_WINDOW_MINUTES) {
        if (r.template_sent) continue;
        const marked = await markReminder("nightly_ping", phone, dateKey);
        if (!marked) continue;
        try {
          await sendTemplate({ to: phone, template: tmpl, contextType: "TEMPLATE_REOPEN", meta: { reopen_reason: "nightly_ping" } });
          templateSent++;
        } catch (e: any) {
          try {
            await logOutbound({ direction: "out", status: "ERROR", templateName: tmpl, payload: { error: String(e), meta: { phoneE164: phone, _type: "TEMPLATE_OUTBOUND" } } });
          } catch {}
        }
      } else if (minutes >= PRE_WINDOW_MINUTES) {
        if (r.text_sent) continue;
        const marked = await markReminder("pre24_ping", phone, dateKey);
        if (!marked) continue;
        const res = await sendTextSafe(phone, REMINDER_TEXT, "AI_DISPATCH_TEXT", { gpt_sent: true });
        if ((res as any)?.ok) textReminders++;
      }
    }

    return NextResponse.json({ ok: true, count: rows.length, templateSent, textReminders });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 200 });
  }
}
