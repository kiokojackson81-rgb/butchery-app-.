#!/usr/bin/env -S tsx
// Minimal script to send a plain text WhatsApp message via the Graph API
(async () => {
  const nodeFetch = (await import('node-fetch')).default;
  const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '');
  const token = String(process.env.WHATSAPP_TOKEN || '');
  const toArg = process.argv[2] || process.env.TO || '849934581535490';
  const message = process.argv[3] || process.env.MESSAGE || 'Test message from BarakaOps dev — please reply to open session';

  if (!phoneId || !token) {
    console.error('Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN in env');
    process.exit(2);
  }

  const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneId)}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: String(toArg).replace(/^\+/, ''),
    type: 'text',
    text: { body: message }
  };

  try {
    const res = await nodeFetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(()=>({}));
    console.log('status', res.status);
    console.log(JSON.stringify(json, null, 2));
    if (!res.ok) process.exit(3);
    process.exit(0);
  } catch (e: any) {
    console.error('fetch failed', e?.message || e);
    process.exit(4);
  }
})();
