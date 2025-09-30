// app/api/supplier/report/route.ts
import { NextResponse } from "next/server";
import { buildReportJSON } from "@/server/supplier/supplier.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || "";
  const outlet = searchParams.get("outlet") || "";
  const format = (searchParams.get("format") || "json").toLowerCase();

  if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });

  const data = await buildReportJSON(date, outlet);
  if (format === "json") return NextResponse.json({ ok: true, data });

  return NextResponse.json({ ok: true, data, note: "PDF generation not wired yet" });
}
