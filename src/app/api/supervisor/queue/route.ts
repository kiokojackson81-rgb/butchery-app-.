// app/api/supervisor/queue/route.ts
import { NextResponse } from "next/server";
import { listQueue } from "@/server/supervisor/queue.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = Object.fromEntries(searchParams.entries());
  const data = await listQueue(query);
  return NextResponse.json({ ok: true, ...data });
}
