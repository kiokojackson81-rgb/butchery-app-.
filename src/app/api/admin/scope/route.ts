import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";

/**
 * Body shape:
 * {
 *   "<normalizedCode>": { outlet: "Baraka A", productKeys: ["beef","goat"] },
 *   ...
 * }
 */
export async function POST(req: Request) {
  try {
    const scope = await req.json();
    if (!scope || typeof scope !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const entries = Object.entries(scope) as Array<[
      string,
      { outlet?: string; productKeys?: string[] }
    ]>;

    await Promise.all(
      entries.map(([code, v]) =>
        (prisma as any).attendantAssignment.upsert({
          where: { code },
          update: { outlet: v.outlet || "", productKeys: v.productKeys || [] },
          create: { code, outlet: v.outlet || "", productKeys: v.productKeys || [] },
        })
      )
    );

    return NextResponse.json({ ok: true, count: entries.length });
  } catch (e) {
    console.error("save scope error", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
