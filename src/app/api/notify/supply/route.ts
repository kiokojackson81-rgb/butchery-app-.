import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";
import { notifySupplyMultiRole, SupplyPayload } from "@/lib/wa_supply_notify";

async function resolvePhones(outlet: string, supplierCode?: string | null) {
  const attendants = await prisma.phoneMapping.findMany({ where: { role: "attendant", outlet } });
  const supervisor = await prisma.phoneMapping.findFirst({ where: { role: "supervisor" } });
  const supplier = supplierCode
    ? await prisma.phoneMapping.findFirst({ where: { code: supplierCode } })
    : null;
  return {
    attendant: attendants[0]?.phoneE164 || null,
    supervisor: supervisor?.phoneE164 || null,
    supplier: supplier?.phoneE164 || null,
  };
}

export async function POST(req: Request) {
  try {
    const key = req.headers.get("x-internal-key");
    const expected = process.env.INTERNAL_API_KEY;
    if (expected && key !== expected) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      payload?: SupplyPayload;
      supplierCode?: string | null;
      templates?: { attendant?: string; supplier?: string; supervisor?: string };
    };
    if (!body?.payload || !body.payload.outlet || !Array.isArray(body.payload.items)) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
    }
    const phones = await resolvePhones(body.payload.outlet, body.supplierCode || null);
    const fallbackTemplates = body.templates || {
      attendant: process.env.SUPPLY_TEMPLATE_ATTENDANT || undefined,
      supplier: process.env.SUPPLY_TEMPLATE_SUPPLIER || undefined,
      supervisor: process.env.SUPPLY_TEMPLATE_SUPERVISOR || undefined,
    };
    const res = await notifySupplyMultiRole({ payload: body.payload, phones, templates: fallbackTemplates });
  return NextResponse.json({ ok: true, result: res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
