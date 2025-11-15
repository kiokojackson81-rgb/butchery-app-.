import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function toEnumFromOutletName(name?: string | null): any | null {
  if (!name) return null;
  const s = String(name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const aliases: Record<string, string> = {
    BRIGHT: "BRIGHT",
    BARAKA: "BARAKA_A",
    BARAKA_A: "BARAKA_A",
    BARAKA_B: "BARAKA_B",
    BARAKA_C: "BARAKA_C",
    GENERAL: "GENERAL",
  };
  return aliases[s] || null;
}

export async function POST(req: Request) {
  try {
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    const dry = String(process.env.WA_DRY_RUN || "true").toLowerCase() === "true";
    if (isProd && !dry) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({} as any));
    const outletCodeRaw: string | undefined = body.outletCode;
    const outletName: string | undefined = body.outletName;
    const amount: number = Number(body.amount || 0);
    const status: string = (body.status || "SUCCESS").toString().toUpperCase();
    const createdAtIso: string | undefined = body.createdAt;

    if (!amount || amount <= 0) return NextResponse.json({ ok: false, error: "amount>0 required" }, { status: 400 });
    if (!outletCodeRaw && !outletName) return NextResponse.json({ ok: false, error: "outletCode or outletName required" }, { status: 400 });

    const allowed = ["BRIGHT", "BARAKA_A", "BARAKA_B", "BARAKA_C", "GENERAL"];
    let outletCode = outletCodeRaw ? String(outletCodeRaw).trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_") : null;
    if (!outletCode || !allowed.includes(outletCode)) outletCode = toEnumFromOutletName(outletName);
    if (!outletCode || !allowed.includes(outletCode)) return NextResponse.json({ ok: false, error: "invalid outlet code" }, { status: 400 });

    const createdAt = createdAtIso ? new Date(createdAtIso) : new Date();
    const row = await (prisma as any).payment.create({
      data: {
        outletCode,
        amount: Math.round(amount),
        msisdn: "254700000000",
        status,
        businessShortCode: "TEST",
        partyB: "TEST",
        storeNumber: "TEST",
        headOfficeNumber: "TEST",
        accountReference: "TEST",
        description: "TEST_HELPER",
        createdAt,
      },
    });

    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
