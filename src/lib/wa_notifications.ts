import { sendText } from '@/lib/wa';
import sendWhatsAppTemplateMessage from '@/lib/whatsapp/sendTemplate';
import { computeDayTotals } from '@/server/finance';

export async function sendHighValueAlert({ to, outlet, amount, payer, time, till, ref }: { to: string; outlet: string; amount: number; payer: string; time: string; till: string; ref: string }) {
  try {
    const tpl = process.env.WA_TEMPLATE_NAME_HIGH_VALUE || 'high_value_payment_alert';
    return await sendWhatsAppTemplateMessage({ to, templateName: tpl, bodyParams: [ outlet, String(amount), payer, time, till, ref, '' ] });
  } catch (e) { console.error('sendHighValueAlert failed', e); return null; }
}

export async function sendMidnightSummary({ to, outlet, date, count, total, topPayers }: { to: string; outlet: string; date: string; count: number; total: number; topPayers: string }) {
  try {
    const tpl = process.env.WA_TEMPLATE_NAME_MIDNIGHT || 'midnight_payment_summary';
    return await sendWhatsAppTemplateMessage({ to, templateName: tpl, bodyParams: [ outlet, date, String(count), String(total), topPayers ] });
  } catch (e) { console.error('sendMidnightSummary failed', e); return null; }
}

export async function sendBalanceReply({ to, outlet, date }: { to: string; outlet: string; date: string }) {
  try {
    const stats = await computeDayTotals({ date, outletName: outlet });
    const total = Math.round((stats.tillSalesGross || 0));
    const count = (stats && (stats.tillSalesGross !== undefined)) ? (Array.isArray((stats as any).payments) ? (stats as any).payments.length : 0) : 0;
    const tpl = process.env.WA_TEMPLATE_NAME_BALANCE || 'till_balance_response';
    return await sendWhatsAppTemplateMessage({ to, templateName: tpl, bodyParams: [ outlet, date, String(total), String(count) ] });
  } catch (e) { console.error('sendBalanceReply failed', e); return null; }
}
