import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: { key: string } }
) {
  const row = await prisma.setting.findUnique({
    where: { key: params.key },
  });
  return NextResponse.json({ ok: true, value: (row as any)?.value ?? null });
}

export async function POST(
  req: Request,
  { params }: { params: { key: string } }
) {
  const body = (await req.json().catch(() => ({}))) as { value?: any };
  const saved = await prisma.setting.upsert({
    where: { key: params.key },
    create: { key: params.key, value: body?.value ?? null },
    update: { value: body?.value ?? null },
  });
  return NextResponse.json({ ok: true, value: (saved as any).value });
}
