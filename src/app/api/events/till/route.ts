import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { APP_TZ, dateISOInTZ } from "@/server/trading_period";

function toEnum(outlet: string | null | undefined): string | null {
  if (!outlet) return null;
  const c = String(outlet).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const allowed = ["BRIGHT", "BARAKA_A", "BARAKA_B", "BARAKA_C", "GENERAL"] as const;
  if ((allowed as readonly string[]).includes(c)) return c;
  const aliases: Record<string, string> = { BRIGHT: "BRIGHT", BARAKA: "BARAKA_A", BARAKA_A: "BARAKA_A", BARAKA_B: "BARAKA_B", BARAKA_C: "BARAKA_C", GENERAL: "GENERAL" };
  return aliases[c] || null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outletName = searchParams.get("outlet") || ""; // human name like "Bright" or code
  if (!outletName) return NextResponse.json({ ok: false, error: "missing_outlet" }, { status: 400 });

  const outletEnum = toEnum(outletName);
  if (!outletEnum) return NextResponse.json({ ok: false, error: `unknown_outlet_code:${outletName}` }, { status: 400 });

  // Establish current period start boundary
  const tz = APP_TZ;
  const today = dateISOInTZ(new Date(), tz);
  const fixedOffset = tz === "Africa/Nairobi" ? "+03:00" : "+00:00";
  const outletForActive = outletName; // ActivePeriod stores outletName (friendly name) in most deployments

  let startAt: Date | null = null;
  try {
    const active = await (prisma as any).activePeriod.findFirst({ where: { outletName: { equals: outletForActive, mode: 'insensitive' } } });
    startAt = active?.periodStartAt ? new Date(active.periodStartAt) : null;
  } catch {}
  if (!startAt) startAt = new Date(`${today}T00:00:00${fixedOffset}`);

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let prev = 0;
      let heartbeat = 0;

      async function tick() {
        try {
          const where: any = { outletCode: outletEnum, status: 'SUCCESS', createdAt: { gte: startAt! } };
          const agg = await (prisma as any).payment.aggregate({ where, _sum: { amount: true } });
          const gross = Number(agg?._sum?.amount || 0);
          if (gross !== prev) {
            const payload = JSON.stringify({ type: 'till_gross', outlet: outletName, outletEnum, period: 'current', gross, delta: gross - prev, at: new Date().toISOString() });
            controller.enqueue(enc.encode(`event: till\n`));
            controller.enqueue(enc.encode(`data: ${payload}\n\n`));
            prev = gross;
          }
          heartbeat++;
          if (heartbeat % 10 === 0) {
            controller.enqueue(enc.encode(`: keep-alive ${Date.now()}\n\n`));
          }
        } catch (e) {
          controller.enqueue(enc.encode(`event: error\n`));
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: String(e) })}\n\n`));
        }
      }

      // initial emit
      tick();
      const id = setInterval(tick, 2000);

      const close = () => {
        clearInterval(id);
        try { controller.close(); } catch {}
      };
      // Abort on client disconnect
      (req as any).signal?.addEventListener?.('abort', close);
    },
    cancel() {}
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
