import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeDayTotals } from '@/server/finance';
import { sendMidnightSummary } from '@/lib/wa_notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizePhone(phone: string | null | undefined) {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return null;
  return `+${digits}`;
}

export async function GET(req: Request) {
  try {
    const date = new Date().toISOString().slice(0,10);
    const adminPhonesRaw = (process.env.ADMIN_PHONES || process.env.ADMIN_PHONE || '');
    const adminPhones = adminPhonesRaw.split(',').map(s=>s.trim()).filter(Boolean);
    const barakaASupervisor = process.env.SUPERVISOR_BARAKA_A || null;
    const kyaloPhone = process.env.KYALO_PHONE || null;

    // Supervisors should receive the same summary as admins (all outlets), plus
    // optional outlet-specific summaries when mapped to an outlet.
    const roleMappings = await (prisma as any).phoneMapping.findMany({
      where: { phoneE164: { not: '' }, role: { in: ['admin', 'supervisor'] } },
      select: { phoneE164: true, role: true, outlet: true },
    }).catch(() => []);

    const dbAdmins = Array.from(
      new Set(
        (roleMappings as any[])
          .filter((m) => String(m?.role || '').toLowerCase() === 'admin')
          .map((m) => normalizePhone(m?.phoneE164))
          .filter(Boolean) as string[]
      )
    );

    const dbSupervisors = Array.from(
      new Set(
        (roleMappings as any[])
          .filter((m) => String(m?.role || '').toLowerCase() === 'supervisor')
          .map((m) => normalizePhone(m?.phoneE164))
          .filter(Boolean) as string[]
      )
    );

    const allRecipients = Array.from(
      new Set(
        [...adminPhones.map(normalizePhone).filter(Boolean) as string[], ...dbAdmins, ...dbSupervisors]
      )
    );

    const outlets = await (prisma as any).outlet.findMany().catch(()=>[]);
    let totalCount = 0; let totalAmt = 0; let topPayersArr: string[] = [];
    for (const o of outlets) {
      const stats = await computeDayTotals({ date, outletName: o.name });
      const paymentsCount = stats ? (Array.isArray((stats as any).payments) ? (stats as any).payments.length : (stats.tillSalesGross ? 1 : 0)) : 0;
      totalCount += paymentsCount;
      totalAmt += Math.round(stats.tillSalesGross || 0);
      topPayersArr.push(`${o.name}:${Math.round(stats.tillSalesGross||0)}`);

      // Outlet-specific supervisors (only those explicitly mapped to this outlet)
      const outletSupers = Array.from(
        new Set(
          (roleMappings as any[])
            .filter((m) => String(m?.role || '').toLowerCase() === 'supervisor')
            .filter((m) => (m?.outlet || '') && String(m.outlet).toLowerCase() === String(o.name || '').toLowerCase())
            .map((m) => normalizePhone(m?.phoneE164))
            .filter(Boolean) as string[]
        )
      );
      for (const phone of outletSupers) {
        await sendMidnightSummary({ to: phone, outlet: String(o.name || ''), date, count: paymentsCount, total: Math.round(stats.tillSalesGross||0), topPayers: '' });
      }

      if (o.name === 'Baraka A') {
        const sup = normalizePhone(barakaASupervisor);
        const kya = normalizePhone(kyaloPhone);
        if (sup) await sendMidnightSummary({ to: sup, outlet: 'Baraka A', date, count: paymentsCount, total: Math.round(stats.tillSalesGross||0), topPayers: '' });
        if (kya) await sendMidnightSummary({ to: kya, outlet: 'Baraka A', date, count: paymentsCount, total: Math.round(stats.tillSalesGross||0), topPayers: '' });
      }
    }
    const topPayers = topPayersArr.slice(0,5).join(', ');
    for (const phone of allRecipients) {
      await sendMidnightSummary({ to: phone, outlet: 'All outlets', date, count: totalCount, total: totalAmt, topPayers });
    }
    return NextResponse.json({ ok: true });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
