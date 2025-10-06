import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { sendTemplate } from "@/lib/wa";

export async function GET() {
  try {
    const list = await (prisma as any).phoneMapping.findMany({ where: { role: { in: ["supervisor", "admin"] }, phoneE164: { not: "" } } });
    let count = 0;
    for (const row of list as any[]) {
      const phone = row.phoneE164 as string;
      const params = ["Please confirm your role to continue.", (process.env.APP_ORIGIN || "https://barakafresh.com") + "/login?src=wa"];
      try { await sendTemplate({ to: phone, template: "ops_role_notice", params, contextType: "TEMPLATE_REOPEN" }); count++; } catch {}
    }
    return NextResponse.json({ ok: true, count });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
