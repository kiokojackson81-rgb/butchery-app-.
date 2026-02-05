// Centralized WhatsApp Cloud configuration
export const graphVersion = process.env.GRAPH_VERSION || 'v21.0';
export const GRAPH_BASE = `https://graph.facebook.com/${graphVersion}`;

export function getPhoneNumberId(): string {
  const v = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!v) throw new Error('Missing env WHATSAPP_PHONE_NUMBER_ID');
  return v;
}

export function getWabaId(): string {
  const v = process.env.WHATSAPP_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!v) throw new Error('Missing env WHATSAPP_WABA_ID');
  return v;
}

export function getToken(): string {
  const v = process.env.WHATSAPP_TOKEN;
  if (!v) throw new Error('Missing env WHATSAPP_TOKEN');
  return v;
}

export function getAppSecret(): string | undefined {
  return process.env.WHATSAPP_APP_SECRET;
}

export const webhookPath = process.env.WHATSAPP_WEBHOOK_PATH || '/api/wa/webhook';

export function hasPhoneNumberId(): boolean {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export function hasWabaId(): boolean {
  return Boolean(process.env.WHATSAPP_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);
}

export function hasToken(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN);
}
