import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/wa";

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));
    const msg = payload?.message?.text || payload?.text || "";
    const from = payload?.from || payload?.sender || "";

    const text = String(msg || "").trim();
    const m = /^request\s+([a-zA-Z0-9_-]+)\s+([0-9]+(\.[0-9]+)?)$/i.exec(text);
    if (m) {
      const productKey = m[1].toLowerCase();
      const qty = Number(m[2]);

      const map = await (prisma as any).phoneMapping.findFirst({ where: { phoneE164: from } });
      const outlet = map?.outlet || "Unknown";

      await (prisma as any).supplyRequest.create({
        data: { outlet, productKey, qty, status: "pending", source: "whatsapp", requestedBy: from },
      });

      const suppliers = await (prisma as any).phoneMapping.findMany({ where: { role: "supplier" } });
      const supervisors = await (prisma as any).phoneMapping.findMany({ where: { role: "supervisor" } });

      const notice = `\uD83D\uDCE6 Supply request: ${outlet} needs ${qty} ${productKey}.`;
      await Promise.all([
        ...suppliers.map((s: any) => sendText(s.phoneE164, notice, "AI_DISPATCH_TEXT")),
        ...supervisors.map((s: any) => sendText(s.phoneE164, notice, "AI_DISPATCH_TEXT")),
        sendText(from, `\u2705 Request received for ${qty} ${productKey}. Supervisor will confirm.`, "AI_DISPATCH_TEXT"),
      ]);

      return NextResponse.json({ ok: true });
    }

  await sendText(from, `\uD83D\uDC4B Hi! To request supply, send: "request <itemKey> <qty>". Example: request beef 20`, "AI_DISPATCH_TEXT");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
