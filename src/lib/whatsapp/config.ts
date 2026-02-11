// Centralized WhatsApp Cloud configuration getters
const graphVersion = process.env.GRAPH_VERSION || process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
export const GRAPH_BASE = `${process.env.WHATSAPP_GRAPH_BASE || 'https://graph.facebook.com'}/${graphVersion}`;

export function getPhoneNumberId(): string {
  return String(process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID || '');
}

export function getWabaId(): string {
  return String(process.env.WHATSAPP_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '');
}

export function getToken(): string {
  return String(process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || '');
}

export function getAppSecret(): string | null {
  return process.env.WHATSAPP_APP_SECRET || process.env.WHATSAPP_APPSECRET || null;
}

export const webhookPath = process.env.WHATSAPP_WEBHOOK_PATH || '/api/wa/webhook';

export function hasPhoneNumberId(): boolean { return !!getPhoneNumberId(); }
export function hasWabaId(): boolean { return !!getWabaId(); }
export function hasToken(): boolean { return !!getToken(); }

export default {
  GRAPH_BASE,
  getPhoneNumberId,
  getToken,
  getAppSecret,
  webhookPath,
  hasPhoneNumberId,
  hasWabaId,
  hasToken,
  getWabaId,
};
