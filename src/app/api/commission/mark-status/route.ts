import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === 'string') : [];
    const status: string = typeof body?.status === 'string' ? body.status : '';
    const note: string | undefined = typeof body?.note === 'string' ? body.note : undefined;
    if (!ids.length) return NextResponse.json({ ok: false, error: "ids[] required" }, { status: 400 });
    if (!status) return NextResponse.json({ ok: false, error: "status required" }, { status: 400 });
    const data: any = { status };
    if (typeof note !== 'undefined') data.note = note;
    const res = await (prisma as any).supervisorCommission.updateMany({ where: { id: { in: ids } }, data });
    return NextResponse.json({ ok: true, count: res?.count ?? 0 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
