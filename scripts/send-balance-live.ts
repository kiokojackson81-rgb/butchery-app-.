#!/usr/bin/env tsx
import sendWhatsAppTemplateMessage from '../src/lib/whatsapp/sendTemplate';
import { computeDayTotals } from '../src/server/finance';

(async ()=>{
  try {
    const toArg = process.argv[2] || process.env.SUPERVISOR_BARAKA_A || process.env.ADMIN_PHONE;
    if (!toArg) throw new Error('No recipient specified (arg or SUPERVISOR_BARAKA_A or ADMIN_PHONE)');
    const to = String(toArg).replace(/^\+/, '');
    const date = new Date().toISOString().slice(0,10);
    const stats = await computeDayTotals({ date, outletName: 'Baraka A' });
    const total = Math.round(stats.tillSalesGross || 0);
    const count = Array.isArray((stats as any).payments) ? (stats as any).payments.length : (total ? 1 : 0);

    const res = await sendWhatsAppTemplateMessage({
      to,
      templateName: 'till_balance_response',
      bodyParams: ['Baraka A', date, String(total), String(count)],
    });
    console.log('send result', res);
  } catch (e:any) {
    console.error('failed', e?.message || e);
    process.exit(2);
  }
})();
