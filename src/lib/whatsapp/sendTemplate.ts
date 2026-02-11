import { sendTemplate } from '@/lib/wa';

export async function sendWhatsAppTemplateMessage({ to, templateName, bodyParams, langCode }: {
  to: string;
  templateName: string;
  bodyParams: Array<string | number>;
  langCode?: string | null;
}) {
  // Delegate to centralized transport which handles dry-run, autosend, and logging
  return sendTemplate({ to, template: templateName, params: (bodyParams || []).map(String), langCode, contextType: 'TEMPLATE_OUTBOUND' });
}

export default sendWhatsAppTemplateMessage;
