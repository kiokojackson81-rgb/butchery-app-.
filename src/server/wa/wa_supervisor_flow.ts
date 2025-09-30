// src/server/wa/wa_supervisor_flow.ts
import { sendText } from "@/lib/wa";
import { prisma } from "@/lib/db";
import { listQueue } from "@/server/supervisor/queue.service";
import { reviewItem } from "@/server/supervisor/review.service";
import { getOutletSummary } from "@/server/supervisor/summary.service";

function pick<T>(arr: T[], n = 5) {
  return arr.slice(0, n);
}

export async function handleSupervisorText(fromGraph: string, text: string) {
  const t = text.trim();
  // Resolve supervisor code from phone mapping
  let supCode: string | undefined = undefined;
  try {
    const phoneE164 = "+" + (fromGraph || "");
    const map = await (prisma as any).phoneMapping.findFirst({ where: { phoneE164, role: "supervisor" } });
    supCode = map?.code as string | undefined;
  } catch {}

  if (/^QUEUE$/i.test(t)) {
    const { items } = await listQueue({ status: "pending", limit: 5 });
    if (!items.length) {
      await sendText(fromGraph, "Queue is empty. ✅");
      return true;
    }
    const lines = pick(items as any, 5)
      .map((i: any) => {
        const p = i.payload as any;
        const head = `#${i.id.slice(-6)} ${i.type.toUpperCase()} (${i.status})`;
        const outlet = i.outlet;
        const date = String(i.date).slice(0, 10);
        let detail = "";
        if (i.type === "dispute") detail = `${p?.itemKey} ${p?.qty ?? ""} • ${p?.reason ?? ""}`;
        if (i.type === "supply_edit") detail = `rows: ${(p?.rows?.length ?? 0)}`;
        if (i.type === "deposit") detail = `KSh ${p?.parsed?.amount ?? "?"} vs exp ${p?.expected ?? "?"}`;
        return `${head}\n${outlet} • ${date}\n${detail}\n`;
      })
      .join("\n");
    await sendText(fromGraph, `Pending:\n\n${lines}\nReply:\nAPPROVE <id> or REJECT <id> <note>`);
    return true;
  }

  const mA = t.match(/^APPROVE\s+([A-Za-z0-9\-_]+)/i);
  if (mA) {
    const id = mA[1];
  await reviewItem({ id, action: "approve" }, supCode || "SUPERVISOR");
    await sendText(fromGraph, `✅ Approved #${id.slice(-6)}.`);
    return true;
  }

  const mR = t.match(/^REJECT\s+([A-Za-z0-9\-_]+)\s*(.*)$/i);
  if (mR) {
    const id = mR[1];
    const note = (mR[2] || "").trim() || undefined;
  await reviewItem({ id, action: "reject", note }, supCode || "SUPERVISOR");
    await sendText(fromGraph, `❌ Rejected #${id.slice(-6)}${note ? ` — ${note}` : ""}.`);
    return true;
  }

  const mS = t.match(/^SUMMARY\s+(\d{4}-\d{2}-\d{2})\s+OUTLET\s+(.+)$/i);
  if (mS) {
    const date = mS[1];
    const outlet = mS[2].trim();
    const { data } = (await getOutletSummary({ date, outlet })) as any;
    const dep = data.totals?.expectedDeposit ?? "?";
    const cs = data.closings?.length ?? 0;
    const ex = (data.expenses || []).reduce((s: number, e: any) => s + e.amount, 0);
    await sendText(fromGraph, `Summary ${outlet} • ${date}\nClosing rows: ${cs}\nExpenses: KSh ${ex}\nExpected deposit: KSh ${dep}`);
    return true;
  }

  if (/^HELP$/i.test(t)) {
    await sendText(
      fromGraph,
      "Supervisor commands:\n" +
        "QUEUE\n" +
        "APPROVE <id>\n" +
        "REJECT <id> <note>\n" +
        "SUMMARY YYYY-MM-DD OUTLET <name>"
    );
    return true;
  }

  return false;
}
