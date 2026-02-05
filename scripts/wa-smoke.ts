#!/usr/bin/env -S tsx
// Simple smoke test: send a text using centralized WhatsApp config.
(async () => {
  const { GRAPH_BASE, getPhoneNumberId, getToken } = await import('../src/lib/whatsapp/config');
  const nodeFetch = (await import('node-fetch')).default;
  const to = process.argv[2] || process.env.TO || '';
  const text = process.argv[3] || process.env.MESSAGE || 'WhatsApp smoke test from butchery-app';
  const dry = (process.env.WA_DRY_RUN === 'true') || (process.env.NODE_ENV !== 'production');

  if (!to) {
    console.error('Usage: wa-smoke.ts <toE164_no_plus> [message]');
    process.exit(2);
  }

  if (dry) {
    console.log('WA_DRY_RUN active — would send to', to, 'message:', text);
    process.exit(0);
  }

  const phoneId = getPhoneNumberId();
  const token = getToken();
  const url = `${GRAPH_BASE}/${encodeURIComponent(phoneId)}/messages`;
  const body = { messaging_product: 'whatsapp', to: String(to).replace(/^\+/, ''), type: 'text', text: { body: text } };

  try {
    const res = await nodeFetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    console.log('status', res.status);
    console.log(JSON.stringify(json, null, 2));
    process.exit(res.ok ? 0 : 3);
  } catch (e: any) {
    console.error('send failed', e?.message || e);
    process.exit(4);
  }
})();
