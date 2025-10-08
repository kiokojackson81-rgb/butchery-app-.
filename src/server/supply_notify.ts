import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/wa";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { getTodaySupplySummary, SupplySummaryLine } from "@/server/supply";
import { createReviewItem } from "@/server/review";
import { format } from "date-fns";

const moneyFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function money(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return `KSh ${moneyFormatter.format(Math.round(value))}`;
}

function buildLines(lines: SupplySummaryLine[]): string {
  if (!lines.length) return "(no lines)";
  return lines
    .map((line) => `• ${line.name} — ${line.qty} ${line.unit} @ ${money(line.buyPrice)}`)
    .join("\n");
}


function totalBuy(lines: SupplySummaryLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty * line.buyPrice, 0);
}

function uniquePhones(rows: Array<{ phoneE164: string | null }>): string[] {
  const list: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const phone = row?.phoneE164;
    if (!phone) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);
    list.push(phone);
  }
  return list;
}

async function sendBulk(phones: string[], message: string) {
  if (!phones.length) return;
  if (process.env.WA_AUTOSEND_ENABLED === "true") {
    // old path (temporary)
  await Promise.allSettled(phones.map((phone) => sendText(phone, message, "AI_DISPATCH_TEXT")));
  } else {
    await Promise.allSettled(phones.map((phone) => sendOpsMessage(phone, { kind: "free_text", text: message })));
  }
}

export async function notifySupplyPosted(opts: {
  outletName: string;
  date?: string;
  supplierCode?: string | null;
}) {
  const outletName = opts.outletName.trim();
  if (!outletName) return { sent: false, reason: "no-outlet" };
  const date = opts.date || format(new Date(), "yyyy-MM-dd");

  const lines = await getTodaySupplySummary(outletName, date);
  if (!lines.length) return { sent: false, reason: "no-lines" };

  const linesTxt = buildLines(lines);
  const total = totalBuy(lines);

  const attendants = await prisma.phoneMapping.findMany({ where: { role: "attendant", outlet: outletName } });
  const supervisors = await prisma.phoneMapping.findMany({ where: { role: "supervisor" } });
  const admins = await prisma.phoneMapping.findMany({ where: { role: "admin" } });
  const supplier = opts.supplierCode
    ? await prisma.phoneMapping.findUnique({ where: { code: opts.supplierCode } })
    : null;

  const msgAttendant = `Supply received
You’ve been supplied at ${outletName}:
${linesTxt}
If anything is wrong, reply DISPUTE and describe the issue.`;

  const msgSupervisor = `New supply recorded for ${outletName}
${linesTxt}
Total buy: ${money(total)}
Review in dashboard. Disputes will alert you.`;

  const msgAdmin = `Supply posted — ${outletName}
${linesTxt}
Total buy: ${money(total)}
Recorded in system.`;

  const msgSupplier = `Thank you. Supply submitted to ${outletName}
${linesTxt}
If disputed by the outlet, Supervisor will contact you.`;

  await sendBulk(uniquePhones(attendants), msgAttendant);
  await sendBulk(uniquePhones(supervisors), msgSupervisor);
  await sendBulk(uniquePhones(admins), msgAdmin);
  if (supplier?.phoneE164) {
    if (process.env.WA_AUTOSEND_ENABLED === "true") {
  await sendText(supplier.phoneE164, msgSupplier, "AI_DISPATCH_TEXT");
    } else {
      await sendOpsMessage(supplier.phoneE164, { kind: "free_text", text: msgSupplier });
    }
  }

  return { sent: true };
}

export async function handleSupplyDispute(opts: {
  outletName: string;
  date?: string;
  reason: string;
  attendantPhone: string;
  attendantCode?: string | null;
}) {
  const outletName = opts.outletName.trim();
  if (!outletName) return { ok: false, reason: "no-outlet" };
  const date = opts.date || format(new Date(), "yyyy-MM-dd");
  const reason = opts.reason.trim() || "No reason provided";

  const lines = await getTodaySupplySummary(outletName, date);
  const payload = {
    reason,
    lines,
    attendantCode: opts.attendantCode || null,
    date,
  };

  await createReviewItem({ type: "supply-dispute", outlet: outletName, date: new Date(), payload });

  const supervisors = await prisma.phoneMapping.findMany({ where: { role: "supervisor" } });
  const messageSupervisor = `Dispute raised — ${outletName}
Reason: "${reason}".
Please review in the dashboard.`;
  await sendBulk(uniquePhones(supervisors), messageSupervisor);

  const ack = `Dispute logged for ${outletName}. Supervisor has been notified.`;
  if (process.env.WA_AUTOSEND_ENABLED === "true") {
  await sendText(opts.attendantPhone, ack, "AI_DISPATCH_TEXT");
  } else {
    await sendOpsMessage(opts.attendantPhone, { kind: "free_text", text: ack });
  }

  return { ok: true };
}
