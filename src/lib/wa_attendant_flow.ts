// src/lib/wa_attendant_flow.ts
import { prisma } from "@/lib/db";
import { sendTemplate, sendText, sendInteractive, getPhoneByCode } from "@/lib/wa";
import { buildDepositCTA, buildNextSummarySubmit, buildProductList } from "@/lib/wa_messages";
import { saveClosings } from "@/server/closings";
import { computeDayTotals } from "@/server/finance";
import { getTodaySupplySummary } from "@/server/supply";
import { createReviewItem } from "@/server/review";
import { addDeposit, parseMpesaText } from "@/server/deposits";

export async function loadSession(phoneE164: string) {
  const phone = phoneE164.startsWith("+") ? phoneE164 : "+" + phoneE164;
  const s = await (prisma as any).waSession.findUnique({ where: { phoneE164: phone } });
  return s || (await (prisma as any).waSession.create({ data: { phoneE164: phone, role: "attendant", state: "IDLE" } }));
}

export async function getAssignedProducts(code: string) {
  const sc = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: code }, include: { products: true } });
  const rows = (sc?.products || []).map((p: any) => ({ id: p.productKey, title: p.productKey }));
  return rows;
}

export async function handleAttendantInteractive(phoneE164: string, id: string) {
  const s = await loadSession(phoneE164);
  if (id === "NEXT" || id === "SUMMARY" || id === "SUBMIT" || id === "TXNS" || id === "HELP") {
    return handleAttendantText(phoneE164, id);
  }
  // Treat as product id
  const cursor = (s.cursor as any) || { index: 0, rows: [] };
  const idx = cursor.index || 0;
  cursor.index = idx; // keep
  cursor.rows = cursor.rows || [];
  cursor.selected = id;
  await (prisma as any).waSession.update({ where: { id: s.id }, data: { state: "MENU", cursor } });
  return `Selected ${id}. Reply: QTY X.Y or WASTE X.Y`;
}

export async function handleAttendantText(phoneE164: string, text: string) {
  const s = await loadSession(phoneE164);
  const t = text.trim();
  const phone = phoneE164.startsWith("+") ? phoneE164 : "+" + phoneE164;
  const cursor = (s.cursor as any) || { date: new Date().toISOString().slice(0, 10), rows: [], index: 0 };

  const mQty = /^QTY\s+([0-9]+(?:\.[0-9]+)?)$/i.exec(t);
  const mWaste = /^WASTE\s+([0-9]+(?:\.[0-9]+)?)$/i.exec(t);

  if (mQty) {
    const val = Number(mQty[1]);
    if (!cursor.selected) return "Pick a product first. Use the MENU list.";
    upsertRow(cursor, cursor.selected, { closingQty: val });
    await (prisma as any).waSession.update({ where: { id: s.id }, data: { state: "ENTER_QTY", cursor } });
    return `Set QTY ${val} for ${cursor.selected}. You can WASTE X.Y or NEXT.`;
  }
  if (mWaste) {
    const val = Number(mWaste[1]);
    if (!cursor.selected) return "Pick a product first. Use the MENU list.";
    upsertRow(cursor, cursor.selected, { wasteQty: val });
    await (prisma as any).waSession.update({ where: { id: s.id }, data: { state: "ENTER_WASTE", cursor } });
    return `Set WASTE ${val} for ${cursor.selected}. Use NEXT or SUMMARY.`;
  }
  if (/^NEXT$/i.test(t)) {
    cursor.index = (cursor.index || 0) + 1;
    await (prisma as any).waSession.update({ where: { id: s.id }, data: { state: "MENU", cursor } });
    return `Moved to next item. Pick from MENU or send QTY/WASTE.`;
  }
  if (/^SUMMARY$/i.test(t)) {
    const lines = (cursor.rows || []).map((r: any) => `• ${r.productKey}: QTY ${r.closingQty ?? 0}, WASTE ${r.wasteQty ?? 0}`);
    return lines.length ? ["Summary:", ...lines].join("\n") : "No rows yet.";
  }
  if (/^SUBMIT$/i.test(t)) {
    const date = cursor.date || new Date().toISOString().slice(0, 10);
    const outletName = s.outlet || "";
    if (!outletName) return "No outlet bound to your session. Ask supervisor.";
    const rows = (cursor.rows || []).map((r: any) => ({ productKey: r.productKey, closingQty: Number(r.closingQty||0), wasteQty: Number(r.wasteQty||0) }));
    await saveClosings({ date, outletName, rows });
    const totals = await computeDayTotals({ date, outletName });
    await (prisma as any).waSession.update({ where: { id: s.id }, data: { state: "WAIT_DEPOSIT", cursor } });
    return `Submitted. Expected deposit Ksh ${totals.expectedDeposit}.`;
  }
  if (/^TXNS$/i.test(t)) {
    const date = cursor.date || new Date().toISOString().slice(0, 10);
    const outletName = s.outlet || "";
    const rows = await (prisma as any).attendantDeposit.findMany({ where: { date, outletName }, orderBy: { createdAt: "desc" }, take: 10 });
    if (!rows.length) return "No deposits yet today.";
    return rows.map((r: any) => `• ${r.amount} (${r.status}) ${r.note ? `ref ${r.note}` : ""}`).join("\n");
  }
  if (/^HELP$/i.test(t)) {
    return "Commands: MENU, QTY X.Y, WASTE X.Y, NEXT, SUMMARY, SUBMIT, TXNS, DISPUTE <reason>";
  }
  const mDispute = /^DISPUTE\s+(.+)/i.exec(t);
  if (mDispute) {
    const date = cursor.date || new Date().toISOString().slice(0, 10);
    await createReviewItem({ type: "supply", outlet: s.outlet || "", date: new Date(date), payload: { phone, reason: mDispute[1] } });
    return "Noted your dispute. Supervisor will review.";
  }

  // Deposit parse (optional)
  const parsed = parseMpesaText(t);
  if (parsed && s.state === "WAIT_DEPOSIT") {
    await addDeposit({ date: cursor.date, outletName: s.outlet || "", amount: parsed.amount, note: parsed.ref, code: s.code || undefined });
    return `Deposit recorded: Ksh ${parsed.amount} (ref ${parsed.ref}). Send TXNS to view.`;
  }

  if (/^MENU$/i.test(t)) {
    return "Use the product list to choose an item.";
  }

  return "Unrecognized. Send HELP for commands.";
}

function upsertRow(cursor: any, productKey: string, patch: Partial<{ closingQty: number; wasteQty: number }>) {
  const rows = (cursor.rows = cursor.rows || []);
  const r = rows.find((x: any) => x.productKey === productKey) || (rows[rows.push({ productKey }) - 1]);
  Object.assign(r, patch);
}
