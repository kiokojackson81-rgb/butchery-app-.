import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { outletId, outletName, onlyIfInactive = true } = await req.json().catch(()=>({})) as { outletId?: string; outletName?: string; onlyIfInactive?: boolean };
    const id = outletId ? String(outletId) : '';
    const nameRaw = outletName ? String(outletName) : '';
    if (!id && !nameRaw) return NextResponse.json({ ok: false, error: 'missing outletId or outletName' }, { status: 400 });

    let outlet: any = null;
    if (id) outlet = await (prisma as any).outlet.findUnique({ where: { id } }).catch(()=>null);
    if (!outlet && nameRaw) outlet = await (prisma as any).outlet.findFirst({ where: { name: nameRaw } }).catch(()=>null);
    if (!outlet) return NextResponse.json({ ok: false, error: 'outlet not found' }, { status: 404 });
    if (onlyIfInactive && outlet.active) return NextResponse.json({ ok: false, error: 'outlet is active; deactivate first or pass onlyIfInactive=false' }, { status: 400 });

    const outletNameKey = String(outlet.name);
    const results: Record<string, number> = {};
    async function del(model: string, where: any, key: string) {
      try { const r = await (prisma as any)[model].deleteMany({ where }); results[key] = Number(r?.count || 0); } catch { results[key] = 0; }
    }

    // Remove per-outlet rows and locks (string key outletName)
    await del('activePeriod', { outletName: outletNameKey }, 'periods');
    await del('supplyOpeningRow', { outletName: outletNameKey }, 'supplyOpening');
    await del('attendantClosing', { outletName: outletNameKey }, 'closings');
    await del('attendantExpense',  { outletName: outletNameKey }, 'expenses');
    await del('attendantDeposit',  { outletName: outletNameKey }, 'deposits');
    await del('attendantTillCount',{ outletName: outletNameKey }, 'till');
    await del('pricebookRow', { outletName: outletNameKey }, 'pricebook');
    await del('attendantAssignment', { outlet: outletNameKey }, 'assignments');
    await del('reviewItem', { outlet: outletNameKey }, 'reviewItems');
    await del('outletPerformance', { outletName: outletNameKey }, 'outletPerf');
    await del('productSupplyStat', { outletName: outletNameKey }, 'productSupply');
    await del('supplyRecommendation', { outletName: outletNameKey }, 'supplyReco');
    await del('supplyIntervalPerformance', { outletName: outletNameKey }, 'supplyIntervals');
    await del('dayClosePeriod', { outletName: outletNameKey }, 'dayClose');
    await del('supervisorCommission', { outletName: outletNameKey }, 'supervisorCommission');
    await del('outletTargets', { outletName: outletNameKey }, 'outletTargets');
    await del('wasteThreshold', { outletName: outletNameKey }, 'wasteThresholds');

    // Settings keys with outletName embedded
    try {
      const r = await (prisma as any).setting.deleteMany({ where: { key: { contains: `:${outletNameKey}` } } });
      results['settings'] = Number(r?.count || 0);
    } catch { results['settings'] = 0; }

    // Deactivate outlet and null attendant links
    try { await (prisma as any).outlet.update({ where: { id: outlet.id }, data: { active: false } }); } catch {}
    try { await (prisma as any).attendant.updateMany({ where: { outletId: outlet.id }, data: { outletId: null } }); } catch {}

        // Log wipe event for audit/history
        try {
          const key = `wipe_event:${Date.now()}:outlet:${outletNameKey}`;
          await (prisma as any).setting.create({
            data: { key, value: { type: 'outlet', target: outletNameKey, at: new Date().toISOString(), onlyIfInactive, counts: results } },
          });
        } catch {}

        return NextResponse.json({ ok: true, outletId: outlet.id, outletName: outletNameKey, deleted: results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server' }, { status: 500 });
  }
}
