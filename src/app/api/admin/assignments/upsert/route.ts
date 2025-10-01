import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/codeNormalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type UpsertBody = {
  code: string;
  outlet: string;
  productKeys?: unknown;
};

export async function POST(req: Request) {
  try {
    const { code, outlet, productKeys }: UpsertBody = await req.json();

    const normalized = normalizeCode(code || "");
    const outletNameRaw = typeof outlet === "string" ? outlet.trim() : "";

    if (!normalized || !outletNameRaw) {
      return NextResponse.json({ ok: false, error: "code & outlet required" }, { status: 400 });
    }

    const cleanKeys = Array.isArray(productKeys)
      ? Array.from(new Set(productKeys
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim())
          .filter((k) => k.length > 0)))
      : [];

    let outletName = outletNameRaw;
    const outletRow = await (prisma as any).outlet.findFirst({
      where: { name: { equals: outletNameRaw, mode: "insensitive" } },
      select: { name: true },
    });
    if (outletRow?.name) {
      outletName = outletRow.name;
    }

    await (prisma as any).attendantAssignment.upsert({
      where: { code: normalized },
      update: { outlet: outletName, productKeys: cleanKeys },
      create: { code: normalized, outlet: outletName, productKeys: cleanKeys },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("assignments.upsert error", e);
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
