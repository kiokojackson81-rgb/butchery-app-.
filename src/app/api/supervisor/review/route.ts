// app/api/supervisor/review/route.ts
import { NextResponse } from "next/server";
import { reviewItem } from "@/server/supervisor/review.service";
import { validateActorCode } from "@/server/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
  const body = await req.json();
  const actorInput = (body?.actorCode as string) || (req.headers.get("x-actor-code") as string) || null;
  const supervisorCode = (await validateActorCode("supervisor", actorInput)) || "SUPERVISOR";
  const res = await reviewItem(body, supervisorCode);
  return NextResponse.json(res);
  } catch (e: any) {
    const msg = e?.message || "Review failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
