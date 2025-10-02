import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").slice(0, 10);
    const outlet = (searchParams.get("outlet") || "").trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });
    // Use raw query to avoid requiring regenerated Prisma client on Windows
    const rows: Array<{ counted: number }> = (await prisma.$queryRaw`SELECT "counted" FROM "AttendantTillCount" WHERE "date"=${date} AND "outletName"=${outlet} LIMIT 1`) as any;
    const counted = Number(rows?.[0]?.counted ?? 0);
    return NextResponse.json({ ok: true, counted });
  } catch (e) {
    console.warn("tillcount.get.fail", e);
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { date, outlet, counted } = await req.json();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });
    const cVal = Number(counted || 0);
    // Upsert via raw SQL using the unique index on (date, outletName)
    await prisma.$executeRaw`INSERT INTO "AttendantTillCount" ("id", "date", "outletName", "counted") VALUES (${randomUUID()}, ${date}, ${outlet}, ${cVal}) ON CONFLICT ("date", "outletName") DO UPDATE SET "counted" = EXCLUDED."counted"`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.warn("tillcount.post.fail", e);
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
