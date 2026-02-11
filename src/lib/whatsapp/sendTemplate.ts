import { GRAPH_BASE, getPhoneNumberId, getToken } from '@/lib/whatsapp/config';

export async function sendWhatsAppTemplateMessage({ to, templateName, bodyParams }: {
  to: string;
  templateName: string;
  bodyParams: Array<string | number>;
}) {
  const dry = String(process.env.WA_DRY_RUN || '').toLowerCase() === 'true' || (process.env.NODE_ENV || '').toLowerCase() !== 'production' && (process.env.WA_FORCE_LIVE !== 'true');
  if (dry) {
    try { console.log('[WA_DRY_RUN]', templateName, to, bodyParams); } catch {}
    return { ok: true, dryRun: true } as const;
  }

  const token = getToken();
  const phoneNumberId = getPhoneNumberId();
  if (!token || !phoneNumberId) throw new Error('Missing WhatsApp env WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID');

  const toNorm = String(to || '').replace(/^\+/, '');
  const body = {
    messaging_product: 'whatsapp',
    to: toNorm,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en_US' },
      components: [
        { type: 'body', parameters: (bodyParams || []).map((v) => ({ type: 'text', text: String(v) })) },
      ],
    },
  } as any;

  const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[WA_TEMPLATE_FAIL]', res.status, json);
    return { ok: false, status: res.status, data: json } as const;
  }
  return { ok: true, status: res.status, data: json } as const;
}

export default sendWhatsAppTemplateMessage;
