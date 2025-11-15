import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { APP_TZ, dateISOInTZ } from "@/server/trading_period";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outletName = (searchParams.get("outlet") || "").trim();
  if (!outletName) return NextResponse.json({ ok: false, error: "missing_outlet" }, { status: 400 });

  const tz = APP_TZ;
  const initialDate = dateISOInTZ(new Date(), tz);
  let lastStartAt: string | null = null;
  let lastDate = initialDate;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      async function readActive() {
        try {
          const active = await (prisma as any).activePeriod.findFirst({ where: { outletName: { equals: outletName, mode: 'insensitive' } } }).catch(() => null);
          const startAt: string | null = active?.periodStartAt ? new Date(active.periodStartAt).toISOString() : null;
          const nowDate = dateISOInTZ(new Date(), tz);

          // Date change event (second close usually) — let clients advance day
          if (nowDate !== lastDate) {
            const payload = JSON.stringify({ type: 'period', kind: 'date-advance', outlet: outletName, date: nowDate, startAt });
            controller.enqueue(enc.encode(`event: period\n`));
            controller.enqueue(enc.encode(`data: ${payload}\n\n`));
            lastDate = nowDate;
          }

          // Start timestamp change (midday first close)
          if (startAt && startAt !== lastStartAt) {
            // Classify whether same-day or date-advance (redundant with above but harmless)
            const startDate = dateISOInTZ(new Date(startAt), tz);
            const kind = startDate === nowDate ? 'same-day' : 'date-advance';
            const payload = JSON.stringify({ type: 'period', kind, outlet: outletName, date: nowDate, startAt });
            controller.enqueue(enc.encode(`event: period\n`));
            controller.enqueue(enc.encode(`data: ${payload}\n\n`));
            lastStartAt = startAt;
          }

          // heartbeat
          controller.enqueue(enc.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch (e) {
          controller.enqueue(enc.encode(`event: error\n`));
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: String(e) })}\n\n`));
        }
      }

      // Kick-off and interval
      await readActive();
      const id = setInterval(readActive, 2000);

      const close = () => { clearInterval(id); try { controller.close(); } catch {} };
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
