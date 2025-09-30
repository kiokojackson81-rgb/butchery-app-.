// app/api/supplier/products/route.ts
import { NextResponse } from "next/server";
import { listProductsForOutlet } from "@/server/supplier/supplier.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outlet = searchParams.get("outlet") || "";
  if (!outlet) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

  const data = await listProductsForOutlet(outlet);
  return NextResponse.json({ ok: true, data });
}
