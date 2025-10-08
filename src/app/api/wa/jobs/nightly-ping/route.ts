import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTemplate, logOutbound } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = { phone: string; last_in_at: string | null; last_ping_at: string | null };

export async function POST(req: Request) {
  try {
    // Optional protection: require ADMIN_DIAG_KEY if set
    if (process.env.ADMIN_DIAG_KEY) {
      const key = new URL(req.url).searchParams.get("key") || req.headers.get("x-admin-key");
      if (!key || key !== process.env.ADMIN_DIAG_KEY) {
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      }
    }

    const tmpl = (process.env.WA_TEMPLATE_NAME || "ops_role_notice").trim();
    const autosend = process.env.WA_AUTOSEND_ENABLED === "true";
    if (!autosend) {
      return NextResponse.json({ ok: false, error: "autosend disabled" }, { status: 200 });
    }

    // Select candidate phones: mapped and no inbound for 24h, and not pinged today in Nairobi time
    const sql = `
      WITH pm AS (
        SELECT DISTINCT COALESCE("phoneE164", '') AS phone
        FROM "PhoneMapping"
        WHERE "phoneE164" IS NOT NULL AND "phoneE164" <> ''
      ),
      last_in AS (
        SELECT COALESCE(payload->'meta'->>'phoneE164', payload->>'phone') AS phone,
               MAX("createdAt") AS last_in_at
        FROM "WaMessageLog"
        WHERE direction='in' AND "createdAt" > NOW() - INTERVAL '7 days'
        GROUP BY 1
      ),
      last_ping AS (
        SELECT "phoneE164" AS phone, MAX("createdAt") AS last_ping_at
        FROM "ReminderSend"
        WHERE kind='NIGHTLY_PING'
        GROUP BY 1
      )
      SELECT pm.phone, li.last_in_at, lp.last_ping_at
      FROM pm
      LEFT JOIN last_in li ON li.phone = pm.phone
      LEFT JOIN last_ping lp ON lp.phone = pm.phone
      WHERE (li.last_in_at IS NULL OR li.last_in_at < NOW() - INTERVAL '24 hours')
        AND (lp.last_ping_at IS NULL OR (lp.last_ping_at AT TIME ZONE 'Africa/Nairobi')::date < (NOW() AT TIME ZONE 'Africa/Nairobi')::date)
      ORDER BY pm.phone
    `;

    const rows = (await (prisma as any).$queryRawUnsafe(sql)) as Row[];

    let sent = 0;
    for (const r of rows) {
      const phone = r.phone;
      if (!phone) continue;
      try {
        await (prisma as any).reminderSend.create({
          data: { phoneE164: phone, kind: "NIGHTLY_PING", meta: { reason: "inactive_24h", template: tmpl } },
        });
      } catch {
        // If insert fails (unique constraint), skip sending to avoid dup
        continue;
      }
      try {
        await sendTemplate({ to: phone, template: tmpl, contextType: "TEMPLATE_REOPEN", meta: { reopen_reason: "nightly_ping" } });
        sent++;
      } catch (e: any) {
        try {
          await logOutbound({ direction: "out", status: "ERROR", templateName: tmpl, payload: { error: String(e), meta: { phoneE164: phone, _type: "TEMPLATE_OUTBOUND" } } });
        } catch {}
      }
    }

    return NextResponse.json({ ok: true, count: rows.length, sent });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 200 });
  }
}
