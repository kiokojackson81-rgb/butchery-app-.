import { sendText, sendTemplate } from '@/lib/wa';
import { computeDayTotals } from '@/server/finance';

export async function sendHighValueAlert({ to, outlet, amount, payer, time, till, ref }: { to: string; outlet: string; amount: number; payer: string; time: string; till: string; ref: string }) {
  try {
    const tpl = {
      name: 'high_value_payment_alert',
      language: { code: 'en_US' },
      components: [ { type: 'body', parameters: [ { type: 'text', text: outlet }, { type: 'text', text: String(amount) }, { type: 'text', text: payer }, { type: 'text', text: time }, { type: 'text', text: till }, { type: 'text', text: ref } ] } ]
    } as any;
    return await sendTemplate({ to, template: tpl });
  } catch (e) { console.error('sendHighValueAlert failed', e); return null; }
}

export async function sendMidnightSummary({ to, outlet, date, count, total, topPayers }: { to: string; outlet: string; date: string; count: number; total: number; topPayers: string }) {
  try {
    const tpl = {
      name: 'midnight_payment_summary',
      language: { code: 'en_US' },
      components: [ { type: 'body', parameters: [ { type: 'text', text: outlet }, { type: 'text', text: date }, { type: 'text', text: String(count) }, { type: 'text', text: String(total) }, { type: 'text', text: topPayers } ] } ]
    } as any;
    return await sendTemplate({ to, template: tpl });
  } catch (e) { console.error('sendMidnightSummary failed', e); return null; }
}

export async function sendBalanceReply({ to, outlet, date }: { to: string; outlet: string; date: string }) {
  try {
    const stats = await computeDayTotals({ date, outletName: outlet });
    const total = Math.round((stats.tillSalesGross || 0));
    const count = (stats && (stats.tillSalesGross !== undefined)) ? (Array.isArray((stats as any).payments) ? (stats as any).payments.length : 0) : 0;
    const tpl = {
      name: 'till_balance_response',
      language: { code: 'en_US' },
      components: [ { type: 'body', parameters: [ { type: 'text', text: outlet }, { type: 'text', text: date }, { type: 'text', text: String(total) }, { type: 'text', text: String(count) } ] } ]
    } as any;
    return await sendTemplate({ to, template: tpl });
  } catch (e) { console.error('sendBalanceReply failed', e); return null; }
}
