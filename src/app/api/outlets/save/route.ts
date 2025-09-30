import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ ok: false }, { status: 401 });

  const { code, name } = (await req.json()) as { code: string; name: string };
  if (!code || !name) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });

  // In current schema, Outlet.name is unique; code is optional. Upsert by name and set code.
  const outlet = await prisma.outlet.upsert({
    where: { name },
    create: { name, code },
    update: { code },
  });

  return NextResponse.json({ ok: true, outlet });
}
