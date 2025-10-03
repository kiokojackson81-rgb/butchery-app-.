import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull } from "@/server/canon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  const { role, code, phoneE164, outlet } = await req.json();
  if (!role || !phoneE164) return NextResponse.json({ ok:false, error:"role/phone required" }, { status:400 });

  const data: any = { role, phoneE164 };
  if (code) data.code = canonFull(String(code || ""));
  if (outlet) data.outlet = outlet;

  const computedCodeRaw = code ?? `${role}:${outlet ?? ""}`;
  const computedCode = canonFull(String(computedCodeRaw || ""));
  await (prisma as any).phoneMapping.upsert({
    where: { code: computedCode },
    update: data,
    create: { code: computedCode, ...data },
  });

  return NextResponse.json({ ok:true });
}
