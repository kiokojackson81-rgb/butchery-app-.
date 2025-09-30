// app/api/supplier/opening-row/route.ts
import { NextResponse } from "next/server";
import { upsertOpeningRow } from "@/server/supplier/supplier.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const row = await upsertOpeningRow(body);
    return NextResponse.json({ ok: true, row });
  } catch (e: any) {
    const code = e?.code === 403 ? 403 : e?.code === 400 ? 400 : 500;
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: code });
  }
}
