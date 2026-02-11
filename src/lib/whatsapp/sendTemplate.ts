import { waSendTemplate } from './waSendTemplate';

export async function sendWhatsAppTemplateMessage({ to, templateName, bodyParams, langCode }: {
  to: string;
  templateName: string;
  bodyParams: Array<string | number>;
  langCode?: string | null;
}) {
  const dry = String(process.env.WA_DRY_RUN || '').toLowerCase() === 'true' || (process.env.NODE_ENV || '').toLowerCase() !== 'production' && (process.env.WA_FORCE_LIVE !== 'true');
  if (dry) {
    try { console.log('[WA_DRY_RUN]', templateName, to, bodyParams); } catch {}
    return { ok: true, dryRun: true } as const;
  }

  // Delegate to canonical sender (allows optional lang override)
  return waSendTemplate({ to, templateName, bodyParams: (bodyParams || []).map(String), langOverride: langCode || null });
}

export default sendWhatsAppTemplateMessage;
