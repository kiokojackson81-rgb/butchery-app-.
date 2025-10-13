import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getCommissionPeriodFor } from "@/server/commission";
import { sendText } from "@/lib/wa";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const date = (url.searchParams.get('date') || new Date().toISOString().slice(0,10)).slice(0,10);
    const toParam = (url.searchParams.get('to') || '').trim();
    const { key: periodKey } = getCommissionPeriodFor(date);

    // Pull all commissions for the day and period-to-date
    const rows = await (prisma as any).supervisorCommission.findMany({ where: { date }, orderBy: [{ outletName: 'asc' }] });
    const ptd = await (prisma as any).supervisorCommission.findMany({ where: { periodKey }, orderBy: [{ date: 'asc' }] });

    // Group per supervisor
    const bySupDay = new Map<string, Array<any>>();
    for (const r of rows) {
      const k = r.supervisorCode || '__unknown__';
      const a = bySupDay.get(k) || []; a.push(r); bySupDay.set(k, a);
    }
    const bySupPTD = new Map<string, Array<any>>();
    for (const r of ptd) {
      const k = r.supervisorCode || '__unknown__';
      const a = bySupPTD.get(k) || []; a.push(r); bySupPTD.set(k, a);
    }

    let sent = 0, skipped = 0, errors = 0; let total = 0;

    // Filter to single phone if requested
    let targets: Array<{ code: string; phone: string | null; day: any[]; ptd: any[] }> = [];
    const supervisors = await (prisma as any).phoneMapping.findMany({ where: { role: 'supervisor' }, select: { code: true, phoneE164: true } }).catch(() => []);
    for (const sup of supervisors) {
      const code = sup.code || '__unknown__';
      if (toParam) {
        const norm = toParam.startsWith('+') ? toParam : '+' + toParam.replace(/[^0-9+]/g, '');
        if ((sup.phoneE164 || '') !== norm) continue;
      }
      targets.push({ code, phone: sup.phoneE164 || null, day: bySupDay.get(code) || [], ptd: bySupPTD.get(code) || [] });
    }
    // If single mode with unknown number, synthesize a placeholder
    if (toParam && targets.length === 0) {
      const norm = toParam.startsWith('+') ? toParam : '+' + toParam.replace(/[^0-9+]/g, '');
      targets = [{ code: '__unknown__', phone: norm, day: [], ptd: [] }];
    }

    total = targets.length;
    for (const t of targets) {
      const dayLines = t.day.map(r => `- ${r.outletName}: Sales Ksh ${r.salesKsh.toLocaleString()}, Profit Ksh ${r.profitKsh.toLocaleString()}, Commission Ksh ${r.commissionKsh.toLocaleString()}`);
      const dayTotal = t.day.reduce((a, r) => a + (r.commissionKsh||0), 0);
      const ptdTotal = t.ptd.reduce((a, r) => a + (r.commissionKsh||0), 0);
      const msg = [
        `Daily supervisor commission — ${date}`,
        ...(dayLines.length ? dayLines : ['(No commission entries today)']),
        '',
        `Total commission today: Ksh ${dayTotal.toLocaleString()}.`,
        `Period-to-date: Ksh ${ptdTotal.toLocaleString()}.`,
        `— Baraka Fresh Ops`
      ].join('\n');
      try { if (t.phone) { await sendText(t.phone, msg, 'AI_DISPATCH_TEXT'); sent++; } else skipped++; } catch { errors++; }
    }

    return NextResponse.json({ ok: true, sent, skipped, errors, total });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
