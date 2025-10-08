import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normPhone(raw: string | null): { e164: string | null; noPlus: string | null } {
  if (!raw) return { e164: null, noPlus: null };
  const digits = raw.replace(/[^0-9+]/g, "").replace(/^\+?/, "");
  if (!digits) return { e164: null, noPlus: null };
  return { e164: "+" + digits, noPlus: digits };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const { e164, noPlus } = normPhone(searchParams.get("phone") || searchParams.get("to"));
    const hours = Math.max(1, Math.min(168, Number(searchParams.get("hours") || 24)));
    const limit = Math.max(1, Math.min(50, Number(searchParams.get("limit") || 10)));

    // Optional key gate in production (set ADMIN_DIAG_KEY to enable gating)
    const needKey = process.env.NODE_ENV === "production" && !!process.env.ADMIN_DIAG_KEY;
    if (needKey) {
      const key = searchParams.get("key");
      if (!key || key !== process.env.ADMIN_DIAG_KEY) {
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      }
    }

    const phoneClause = e164
      ? `AND (payload->'meta'->>'phoneE164' = $1 OR payload->>'phone' = $1 OR payload->'request'->>'to' = $2 OR payload->>'to' = $2 OR payload->'body'->>'to' = $2)`
      : "";

    const params: any[] = [];
    if (e164) params.push(e164, noPlus);

    // helpers
    async function count(sqlBody: string) {
      const rows = await (prisma as any).$queryRawUnsafe(
        `SELECT COUNT(*)::int AS c FROM "WaMessageLog" WHERE "createdAt" > now() - interval '${hours} hours' ${sqlBody} ${phoneClause}`,
        ...params
      );
      return Array.isArray(rows) && rows[0] ? Number((rows[0] as any).c || 0) : 0;
    }

    async function sample(sqlBody: string) {
      const rows = await (prisma as any).$queryRawUnsafe(
        `SELECT "id", "createdAt", direction, status, type, "templateName", payload::text AS payload\n         FROM "WaMessageLog"\n         WHERE "createdAt" > now() - interval '${hours} hours' ${sqlBody} ${phoneClause}\n         ORDER BY "createdAt" DESC\n         LIMIT ${limit}`,
        ...params
      );
      return rows as any[];
    }

    // table existence
    const tables = await (prisma as any).$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('WaMessageLog','WaSession','PhoneMapping','ReminderSend')`
    );
    const tableSet = new Set((tables as any[]).map((r) => (r as any).table_name));

    // core counts
    const [
      inboundTotal,
      outboundTotal,
      badSignature,
      noop,
      interactiveDisabled,
      dryRun,
      templateReopen,
      inboundDedup,
      loginPrompt,
    ] = await Promise.all([
      count(`AND direction = 'in'`),
      count(`AND direction = 'out'`),
      count(`AND status = 'ERROR' AND payload->>'error' = 'bad signature'`),
      count(`AND (status = 'NOOP' OR type = 'NO_AI_DISPATCH_CONTEXT')`),
      count(`AND type = 'INTERACTIVE_DISABLED'`),
      count(`AND payload::text ILIKE '%"via":"dry-run"%'`),
      count(`AND "templateName" IS NOT NULL`),
      count(`AND status = 'INBOUND_DEDUP'`),
      count(`AND status = 'LOGIN_PROMPT'`),
    ]);

    const samples = await Promise.all([
      sample(`AND status = 'ERROR' AND payload->>'error' = 'bad signature'`),
      sample(`AND (status = 'NOOP' OR type = 'NO_AI_DISPATCH_CONTEXT')`),
      sample(`AND type = 'INTERACTIVE_DISABLED'`),
      sample(`AND payload::text ILIKE '%"via":"dry-run"%'`),
      sample(`AND "templateName" IS NOT NULL`),
      sample(`AND status = 'INBOUND_DEDUP'`),
      sample(`AND status = 'LOGIN_PROMPT'`),
    ]);

    // session + mapping lookups
    const sessionRows = e164 && tableSet.has("WaSession")
      ? await (prisma as any).waSession.findMany({
          where: { OR: [{ phoneE164: e164 }, { phoneE164: noPlus as any }] },
          take: 3,
          orderBy: { updatedAt: "desc" },
        }).catch(() => [])
      : [];

    const mappingRows = e164 && tableSet.has("PhoneMapping")
      ? await (prisma as any).phoneMapping.findMany({
          where: { OR: [{ phoneE164: e164 }, { phoneE164: noPlus as any }] },
          take: 3,
          orderBy: { updatedAt: "desc" },
        }).catch(() => [])
      : [];

    // reminder check (table may be missing on prod)
    const reminderRows = e164 && tableSet.has("ReminderSend")
      ? await (prisma as any).$queryRawUnsafe(
          `SELECT * FROM "ReminderSend" WHERE "phoneE164" IN ($1, $2) ORDER BY "createdAt" DESC LIMIT 10`,
          e164,
          noPlus
        ).catch(() => [])
      : [];

    // Helpful copy-paste queries for Neon UI (with proper quoting)
    const neonSql = {
      badSignature: `SELECT "createdAt", status, type, payload->>'error' AS error\nFROM "WaMessageLog"\nWHERE "createdAt" > now() - interval '${hours} hours'\n  AND status = 'ERROR'\n  AND payload->>'error' = 'bad signature'\nORDER BY "createdAt" DESC\nLIMIT 10;`,
      noop: `SELECT "createdAt", status, type, payload::text\nFROM "WaMessageLog"\nWHERE "createdAt" > now() - interval '${hours} hours'\n  AND (status = 'NOOP' OR type = 'NO_AI_DISPATCH_CONTEXT')\nORDER BY "createdAt" DESC\nLIMIT 20;`,
      interactiveDisabled: `SELECT "createdAt", status, type, payload::text\nFROM "WaMessageLog"\nWHERE "createdAt" > now() - interval '${hours} hours'\n  AND type = 'INTERACTIVE_DISABLED'\nORDER BY "createdAt" DESC\nLIMIT 20;`,
      dryRun: `SELECT "createdAt", status, type, payload::text\nFROM "WaMessageLog"\nWHERE "createdAt" > now() - interval '${hours} hours'\n  AND payload::text ILIKE '%"via":"dry-run"%'\nORDER BY "createdAt" DESC\nLIMIT 20;`,
      templateReopen: `SELECT "createdAt", "templateName", status, type\nFROM "WaMessageLog"\nWHERE "createdAt" > now() - interval '${hours} hours'\n  AND "templateName" IS NOT NULL\nORDER BY "createdAt" DESC\nLIMIT 20;`,
      inboundDedup: `SELECT "createdAt", status, type, payload->>'preview' AS preview\nFROM "WaMessageLog"\nWHERE "createdAt" > now() - interval '${hours} hours'\n  AND status = 'INBOUND_DEDUP'\nORDER BY "createdAt" DESC\nLIMIT 20;`,
      loginPrompt: `SELECT "createdAt", status, type, payload::text\nFROM "WaMessageLog"\nWHERE "createdAt" > now() - interval '${hours} hours'\n  AND status = 'LOGIN_PROMPT'\nORDER BY "createdAt" DESC\nLIMIT 20;`,
      reminder: `SELECT * FROM "ReminderSend" WHERE "phoneE164" IN ('${e164 ?? "+2547..."}', '${noPlus ?? "2547..."}') ORDER BY "createdAt" DESC LIMIT 10;`,
    } as const;

    return NextResponse.json({
      ok: true,
      meta: { phone: e164, hours, limit, tables: Array.from(tableSet) },
      counts: {
        inboundTotal,
        outboundTotal,
        badSignature,
        noop,
        interactiveDisabled,
        dryRun,
        templateReopen,
        inboundDedup,
        loginPrompt,
      },
      samples: {
        badSignature: samples[0],
        noop: samples[1],
        interactiveDisabled: samples[2],
        dryRun: samples[3],
        templateReopen: samples[4],
        inboundDedup: samples[5],
        loginPrompt: samples[6],
      },
      session: sessionRows,
      phoneMapping: mappingRows,
      reminder: reminderRows,
      neonSql,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
