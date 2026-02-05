#!/usr/bin/env -S tsx
// Minimal script that posts directly to the Meta Graph API to send a template
// This avoids importing project files and their build-time complexities.

(async () => {
  const nodeFetch = (await import('node-fetch')).default;
  const { GRAPH_BASE, getPhoneNumberId, getToken } = await import('../src/lib/whatsapp/config');
  const phoneId = String(getPhoneNumberId() || '');
  const token = String(getToken() || '');
  const toArg = process.argv[2] || process.env.TO || '849934581535490';
  const templateArg = process.argv[3] || process.env.TEMPLATE || 'hello_world';

  if (!phoneId || !token) {
    console.error('Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN in env');
    process.exit(2);
  }

  const url = `${GRAPH_BASE}/${encodeURIComponent(phoneId)}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: String(toArg).replace(/^\+/, ''),
    type: 'template',
    template: { name: templateArg, language: { code: 'en_US' } }
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
