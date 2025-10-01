import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull, canonNum } from "@/lib/codeNormalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function ensureNoDigitCollision(code: string) {
  const num = canonNum(code);
  if (!num) return;
  try {
    const collisions = await (prisma as any).$queryRawUnsafe(
      `SELECT code FROM "LoginCode" WHERE regexp_replace(code, '\\D', '', 'g') = ${num}`
    );
    if (collisions.length > 0) {
      const full = canonFull(code);
  const same = (collisions as any[]).some((c: any) => canonFull((c as any).code) === full);
  if (!same) throw new Error(`Digit-core collision with existing code(s): ${(collisions as any[]).map((c: any) => (c as any).code).join(', ')}`);
    }
  } catch {
    // If table not present or raw fails, do not block
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const people: any[] = Array.isArray(body?.people) ? body.people : (body && body.loginCode ? [body] : []);
    if (!Array.isArray(people) || people.length === 0) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });

    let count = 0;
    for (const p of people) {
      if (!p?.code && !p?.loginCode) continue;
      const codeRaw = String(p.code ?? p.loginCode);
      const codeFull = canonFull(codeRaw);
      const role = String(p?.role || 'attendant');
      const active = !!p?.active;

      await ensureNoDigitCollision(codeRaw).catch((e: any) => { throw e; });

      // PersonCode
      try {
        await (prisma as any).personCode.upsert({
          where: { code: codeFull },
          update: { name: p?.name || '', role, active },
          create: { code: codeFull, name: p?.name || '', role, active },
        });
      } catch {}

      // Role-specific persistence (best-effort; schema may vary)
      if (role === 'attendant') {
        // Ensure outlet row exists if provided
        let outletId: string | undefined;
        if (p?.outlet) {
          const out = await (prisma as any).outlet.upsert({
            where: { name: p.outlet },
            update: {},
            create: { name: p.outlet, code: canonFull(p.outlet), active: true },
          }).catch(() => null);
          outletId = out?.id;
        }
        // Update Attendant.loginCode, name, and outletId
        const existing = await (prisma as any).attendant.findFirst({ where: { loginCode: { equals: codeRaw, mode: 'insensitive' } } });
        let attId: string | undefined = existing?.id;
        if (existing) {
          const updated = await (prisma as any).attendant.update({ where: { id: existing.id }, data: { name: p?.name || existing.name, outletId } });
          attId = updated?.id;
        } else {
          const created = await (prisma as any).attendant.create({ data: { name: p?.name || 'Attendant', loginCode: codeFull, outletId } }).catch(() => null);
          attId = created?.id;
        }
        // Create/refresh LoginCode for this attendant (schema requires attendantId, expiresAt)
        if (attId) {
          try {
            await (prisma as any).loginCode.upsert({
              where: { code: codeFull },
              update: { attendantId: attId, expiresAt: new Date(Date.now() + 7*24*3600*1000) },
              create: { code: codeFull, attendantId: attId, expiresAt: new Date(Date.now() + 7*24*3600*1000) },
            });
          } catch {}
        }
      }

      if (role === 'supervisor') {
        try { await (prisma as any).supervisor.upsert({ where: { code: codeFull }, update: { active }, create: { code: codeFull, active } }); } catch {}
      }
      if (role === 'supplier') {
        try { await (prisma as any).supplier.upsert({ where: { code: codeFull }, update: { active }, create: { code: codeFull, active } }); } catch {}
      }

      count++;
    }

    // Mirror to Setting
    await (prisma as any).setting.upsert({ where: { key: 'admin_codes' }, update: { value: people }, create: { key: 'admin_codes', value: people } });

    return NextResponse.json({ ok: true, count });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed' }, { status: 500 });
  }
}
