// app/api/supplier/day/route.ts
import { NextResponse } from "next/server";
import { getDaySnapshot } from "@/server/supplier/supplier.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || "";
  const outlet = searchParams.get("outlet") || "";
  if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });

  const data = await getDaySnapshot(date, outlet);
  return NextResponse.json({ ok: true, data });
}
