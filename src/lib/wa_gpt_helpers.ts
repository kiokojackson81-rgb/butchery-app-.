import { runGptForIncoming } from '@/lib/gpt_router';
import { sendTextSafe } from '@/lib/wa';
import { toGraphPhone } from '@/server/canon';
import { trySendGptInteractive } from './wa_gpt_interact';

/**
 * Send a GPT-composed greeting. If the AI returns a structured interactive payload,
 * attempt to send it (buttons or list). Otherwise fall back to plain text.
 */
export async function sendGptGreeting(phoneE164: string, role: string, outlet?: string) {
  try {
  const prompt = `Prefer returning JSON object with optional fields: { text?: string, interactive?: { type: 'buttons'|'list', buttons?: [{id,title}], sections?: [{title, rows:[{id,title,description}]}], buttonLabel?: string, bodyText?: string, footerText?: string } }.
Return a short (1-2 sentence) greeting for a user logged in as ${role}${outlet ? ` at ${outlet}` : ''}. If user can act via quick replies, include an interactive payload. Ensure buttons are short and <=3; if more actions are needed, use a 'list' structure. Only emit raw JSON (no explanatory text) when possible.`;
  const reply = await runGptForIncoming(phoneE164, prompt);
    // If GPT returned a structured object, it may contain interactive instructions
    if (reply && typeof reply === 'object') {
      const to = toGraphPhone(phoneE164);
      const text = String((reply as any).text || '').trim();
      const inter = (reply as any).interactive as any | undefined;
      // Try sending interactive first (best UX). If it fails, send text fallback.
      if (inter) {
        const sent = await trySendGptInteractive(to.replace(/^\+/, ''), inter as any);
        if (sent) {
          if (text) await sendTextSafe(to, text, 'AI_DISPATCH_TEXT', { gpt_sent: true });
          return;
        }
      }
      if (text) {
        await sendTextSafe(to, text, 'AI_DISPATCH_TEXT', { gpt_sent: true });
        return;
      }
    }
    // Fallback: send whatever string we got
    const raw = String(reply || '').trim();
    if (raw) {
      await sendTextSafe(toGraphPhone(phoneE164), raw, 'AI_DISPATCH_TEXT', { gpt_sent: true });
    }
  } catch (e) { /* best-effort */ }
}

export default {};
