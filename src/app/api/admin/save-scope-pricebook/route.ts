import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/codeNormalize";

type ScopeMap = Record<string, { outlet: string; productKeys: string[] }>;
type PBMap = Record<string, Record<string, { sellPrice: number; active: boolean }>>;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const scope: ScopeMap = body.scope || {};
    const pricebook: PBMap = body.pricebook || {};

    await prisma.$transaction(async (tx) => {
      // Save attendant scope
      for (const [codeNormRaw, entry] of Object.entries(scope)) {
        const codeNorm = normalizeCode(codeNormRaw || "");
        if (!codeNorm) continue;

        const sc = await tx.attendantScope.upsert({
          where: { codeNorm },
          create: { codeNorm, outletName: entry.outlet || "" },
          update: { outletName: entry.outlet || "" },
        });

        await tx.scopeProduct.deleteMany({ where: { scopeId: sc.id } });
        if (Array.isArray(entry.productKeys) && entry.productKeys.length) {
          await tx.scopeProduct.createMany({
            data: entry.productKeys.map((k) => ({ scopeId: sc.id, productKey: k })),
            skipDuplicates: true,
          });
        }
      }

      // Save pricebook
      for (const [outletName, rows] of Object.entries(pricebook)) {
        for (const [productKey, cfg] of Object.entries(rows || {})) {
          await tx.pricebookRow.upsert({
            where: { outletName_productKey: { outletName, productKey } },
            create: { outletName, productKey, sellPrice: Number(cfg.sellPrice || 0), active: !!cfg.active },
            update: { sellPrice: Number(cfg.sellPrice || 0), active: !!cfg.active },
          });
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) });
  }
}
