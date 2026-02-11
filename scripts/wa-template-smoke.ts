#!/usr/bin/env tsx
import sendWhatsAppTemplateMessage from '../src/lib/whatsapp/sendTemplate';

(async () => {
  try {
    const res = await sendWhatsAppTemplateMessage({
      to: process.argv[2] || (process.env.TO || '254700000001'),
      templateName: 'high_value_payment_alert',
      bodyParams: ['Baraka B', '500', '+254700000001', '14:23', 'TILL-1', 'MPESA12345', '12,345'],
    });
    console.log('smoke result', res);
  } catch (e: any) {
    console.error('smoke failed', e?.message || e);
    process.exit(2);
  }
})();
