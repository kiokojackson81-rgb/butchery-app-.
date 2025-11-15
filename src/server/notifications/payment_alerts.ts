import { prisma } from "@/lib/prisma";
import { sendTextSafe } from "@/lib/wa";

type PaymentAlertOpts = {
  outletCode: string;
  amount: number;
  receipt?: string | null;
  payerMsisdn?: string | null;
};

function normalizePhone(phone?: string | null) {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (!digits) return null;
  return `+${digits}`;
}

function maskMsisdn(msisdn?: string | null) {
  if (!msisdn) return null;
  const digits = msisdn.replace(/[^0-9]/g, "");
  if (digits.length <= 4) return digits;
  return `***${digits.slice(-4)}`;
}

function formatOutletLabel(code: string) {
  if (!code) return "the till";
  if (code.toUpperCase() === "GENERAL") return "the GENERAL till";
  return `${code} till`;
}

export async function sendPaymentAlerts(opts: PaymentAlertOpts) {
  try {
    const outletRow = await (prisma as any).outlet
      .findFirst({ where: { code: opts.outletCode }, select: { name: true } })
      .catch(() => null);
    const outletName = String(outletRow?.name || opts.outletCode || "").trim();
    const phoneWhere: any[] = [
      { role: "admin", outlet: null },
      { role: "admin", outlet: "" },
    ];
    if (outletName) {
      phoneWhere.push(
        { role: "supervisor", outlet: { equals: outletName, mode: "insensitive" } },
        { role: "admin", outlet: { equals: outletName, mode: "insensitive" } }
      );
    }
    const needsSupervisorFallback = !outletName || outletName.toUpperCase() === "GENERAL" || opts.outletCode === "GENERAL";
    if (needsSupervisorFallback) {
      phoneWhere.push({ role: "supervisor", outlet: null }, { role: "supervisor", outlet: "" });
    }

    const rows = await (prisma as any).phoneMapping.findMany({
      where: {
        phoneE164: { not: "" },
        OR: phoneWhere,
      },
      select: { phoneE164: true },
    }).catch(() => []);

    const phones = Array.from(
      new Set(
        (rows as Array<{ phoneE164: string | null }>).map((r) => normalizePhone(r.phoneE164)).filter(Boolean) as string[]
      )
    );
    if (!phones.length) return;

    const amountFmt = Math.round(Number(opts.amount) || 0).toLocaleString("en-KE");
    const receiptText = opts.receipt ? ` Receipt ${opts.receipt}.` : "";
    const payerText = opts.payerMsisdn ? ` Payer ${maskMsisdn(opts.payerMsisdn)}.` : "";
    const body = `Payment alert: KSh ${amountFmt} received on ${formatOutletLabel(outletName || opts.outletCode)}.${receiptText}${payerText} - BarakaOps`;

    await Promise.all(phones.map((phone) => sendTextSafe(phone, body, "AI_DISPATCH_TEXT", { gpt_sent: true })));
  } catch {
    // best-effort; swallow
  }
}
