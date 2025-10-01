import { NextResponse } from "next/server";
import { notifyAttendantAssignmentChange, upsertAssignmentForCode } from "@/server/assignments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type UpsertBody = {
  code: string;
  outlet: string;
  productKeys?: unknown;
};

function sanitizeKeys(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    set.add(trimmed);
  }
  return Array.from(set).sort();
}

export async function POST(req: Request) {
  try {
    const { code, outlet, productKeys }: UpsertBody = await req.json();

    const rawCode = typeof code === "string" ? code.trim() : "";
    const outletName = typeof outlet === "string" ? outlet.trim() : "";

    if (!rawCode || !outletName) {
      return NextResponse.json({ ok: false, error: "code & outlet required" }, { status: 400 });
    }

    const keys = sanitizeKeys(productKeys);
    const { canonicalCode, before, after, changed } = await upsertAssignmentForCode(rawCode, outletName, keys);

    if (changed) {
      await notifyAttendantAssignmentChange(canonicalCode, { before, after });
    }

    return NextResponse.json({ ok: true, changed });
  } catch (e: any) {
    console.error("assignments.upsert error", e);
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
