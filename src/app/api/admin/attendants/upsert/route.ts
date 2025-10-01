import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull, canonNum, normalizeCode } from "@/lib/codeNormalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function ensureNoDigitCollision(code: string) {
  const num = canonNum(code);
  if (!num) return;
  const full = canonFull(code);
  let rows: any[] = [];
  try {
    rows = await (prisma as any).$queryRaw`
      SELECT raw_code, canon_code
      FROM "vw_codes_norm"
      WHERE canon_num = ${num}
    `;
  } catch (err) {
    // If we cannot query the view (e.g., during dev or transient issues),
    // do not block the upsert but log in non-prod.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('ensureNoDigitCollision: query failed; skipping check', err);
    }
    return;
  }
  const conflicts = Array.isArray(rows)
    ? rows.filter((r: any) => (r?.canon_code || "") !== full)
    : [];
  if (conflicts.length > 0) {
    const list = conflicts.map((c: any) => c?.raw_code || c?.canon_code || "?");
    throw new Error(`Digit-core collision with existing code(s): ${list.join(', ')}`);
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
      const codeFull = normalizeCode(codeRaw);
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
    const existing = await (prisma as any).attendant.findFirst({ where: { loginCode: { equals: codeFull, mode: 'insensitive' } } });
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
    const msg = String(e?.message || 'Failed');
    const isCollision = /Digit-core collision/i.test(msg);
    return NextResponse.json({ ok: false, error: msg }, { status: isCollision ? 409 : 500 });
  }
}
