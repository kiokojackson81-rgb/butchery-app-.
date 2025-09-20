import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  console.log("C2B VALIDATE:", body);
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
export async function GET() { return NextResponse.json({ ok: true }); }
