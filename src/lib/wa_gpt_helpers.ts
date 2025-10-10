import { runGptForIncoming } from '@/lib/gpt_router';
import { sendTextSafe } from '@/lib/wa';
import { toGraphPhone } from '@/server/canon';

export async function sendGptGreeting(phoneE164: string, role: string, outlet?: string) {
  try {
    const prompt = `Welcome back. You are logged in as ${role}${outlet ? ` at ${outlet}` : ''}. Say a short greeting and ask how you can help.`;
    const reply = await runGptForIncoming(phoneE164, prompt);
    const text = String(reply || '').trim();
    if (text) {
      await sendTextSafe(toGraphPhone(phoneE164), text, 'AI_DISPATCH_TEXT', { gpt_sent: true });
    }
  } catch (e) { /* best-effort */ }
}

export default {};
