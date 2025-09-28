import { sendWaTemplate } from "@/lib/wa";
import { WaTemplates, bodyParams } from "./wa-templates";

export async function sendClosingStockSubmitted(
  to: string,
  outlet: string,
  summaryLine: string
) {
  const t = WaTemplates.closing_stock_submitted;
  return sendWaTemplate(to, t.name, t.lang, bodyParams([outlet, summaryLine]));
}

export async function sendLowStockAlert(
  to: string,
  item: string,
  qty: string
) {
  const t = WaTemplates.low_stock_alert;
  return sendWaTemplate(to, t.name, t.lang, bodyParams([item, qty]));
}

export async function sendSupplyReceived(
  to: string,
  outlet: string,
  grnNoOrNote: string
) {
  const t = WaTemplates.supply_received;
  return sendWaTemplate(to, t.name, t.lang, bodyParams([outlet, grnNoOrNote]));
}

export async function sendSupplyRequest(
  to: string,
  outlet: string,
  listLine: string
) {
  const t = WaTemplates.supply_request;
  return sendWaTemplate(to, t.name, t.lang, bodyParams([outlet, listLine]));
}

export async function sendWasteRejected(
  to: string,
  reason: string
) {
  const t = WaTemplates.waste_rejected;
  return sendWaTemplate(to, t.name, t.lang, bodyParams([reason]));
}
