import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { getSession } from "@/lib/session";
import { getAssignedProducts } from "@/server/products";

export async function GET() {
  try {
    const sess = await getSession();
    if (!sess) return NextResponse.json({ ok: false }, { status: 401 });
    const code = (sess as any)?.attendant?.loginCode || "";
    const products = await getAssignedProducts(code || "");
    return NextResponse.json({ ok: true, products });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
