import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { code, onlyIfInactive = true } = await req.json().catch(()=>({})) as { code?: string; onlyIfInactive?: boolean };
    const loginCode = String(code || '').trim();
    if (!loginCode) return NextResponse.json({ ok: false, error: 'missing code' }, { status: 400 });

    const person = await (prisma as any).personCode.findFirst({ where: { code: { equals: loginCode, mode: 'insensitive' } } }).catch(()=>null);
    if (!person) return NextResponse.json({ ok: false, error: 'code not found' }, { status: 404 });
    if (onlyIfInactive && person.active) return NextResponse.json({ ok: false, error: 'code is active; deactivate first or pass onlyIfInactive=false' }, { status: 400 });

    const results: Record<string, number> = {};
    async function del(model: string, where: any, key: string) {
      try { const r = await (prisma as any)[model].deleteMany({ where }); results[key] = Number(r?.count || 0); } catch { results[key] = 0; }
    }

    // Delete WA sessions and clear code bindings
    await del('waSession', { code: loginCode }, 'waSession');
  // Delete assignment/scope and login code rows
    await del('attendantAssignment', { code: loginCode }, 'assignments');
    await del('attendantScope', { codeNorm: loginCode }, 'scope');
    await del('loginCode', { code: { equals: loginCode, mode: 'insensitive' } }, 'loginCodes');
  await del('attendantDeposit', { code: loginCode }, 'deposits');
  await del('phoneMapping', { code: loginCode }, 'phoneMapping');

    // Clean related attendant rows if present
    let attId: string | undefined;
    try {
      const att = await (prisma as any).attendant.findFirst({ where: { loginCode: { equals: loginCode, mode: 'insensitive' } } });
      attId = att?.id;
    } catch {}
    if (attId) {
      try { await (prisma as any).session.deleteMany({ where: { attendantId: attId } }); } catch {}
      try { await (prisma as any).waMessageLog.updateMany({ where: { attendantId: attId }, data: { attendantId: null } }); } catch {}
      try { await (prisma as any).shift.deleteMany({ where: { attendantId: attId } }); } catch {}
      try { await (prisma as any).productAssignment.deleteMany({ where: { attendantId: attId } }); } catch {}
      try { await (prisma as any).attendantKPI.deleteMany({ where: { attendantId: attId } }); } catch {}
      try { await (prisma as any).attendant.delete({ where: { id: attId } }); } catch {}
    }

    // Deactivate the person code to be safe (idempotent)
    try { await (prisma as any).personCode.updateMany({ where: { code: { equals: loginCode, mode: 'insensitive' } }, data: { active: false } }); } catch {}

    return NextResponse.json({ ok: true, code: loginCode, deleted: results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server' }, { status: 500 });
  }
}
