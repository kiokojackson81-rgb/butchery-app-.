import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendText, sendInteractive } from "@/lib/wa";
import { toGraphPhone } from "@/server/util/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const now = Date.now();
  const cutoff = new Date(now - 10 * 60 * 1000); // 10 minutes

  const idle = await (prisma as any).waSession.findMany({
    where: { state: { notIn: ["LOGGED_OUT"] }, updatedAt: { lt: cutoff } },
    take: 200,
  });

  for (const s of idle) {
    try {
      await (prisma as any).waSession.update({ where: { id: s.id }, data: { state: "LOGGED_OUT" } });
      const to = toGraphPhone((s as any).phoneE164 || "");
      const loginUrl = "https://barakafresh.com/login?src=wa";
  await sendText(to, `You were logged out due to 10 minutes of inactivity.\nLogin again: ${loginUrl}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      await sendInteractive({
        to,
        type: "button",
        body: { text: "Tap a button to continue" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "SEND_CODE", title: "Send Code" } },
            { type: "reply", reply: { id: "MENU", title: "Main Menu" } },
          ],
        },
      } as any, "AI_DISPATCH_INTERACTIVE");
    } catch {}
  }

  return NextResponse.json({ ok: true, expired: idle.length });
}
