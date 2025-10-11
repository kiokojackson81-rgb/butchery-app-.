import { buildInteractiveListPayload } from '@/lib/wa_messages';
import { sendInteractive } from '@/lib/wa';
import { isValidGptInteractive } from './wa_gpt_schema';

type GptInteractive = {
  type: 'buttons' | 'list';
  buttons?: Array<{ id: string; title: string }>;
  sections?: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  buttonLabel?: string;
  bodyText?: string;
  footerText?: string;
};

export async function trySendGptInteractive(to: string, inter: GptInteractive | null | undefined) {
  if (!inter) return false;

  const sendAndConfirm = async (payload: any, kind: 'buttons' | 'list') => {
    const result = await sendInteractive(payload, 'AI_DISPATCH_INTERACTIVE');
    const ok = result?.ok === true;
    if (!ok) {
      try {
        console.warn('[wa_gpt_interact] interactive send failed', {
          kind,
          error: (result as any)?.error || 'unknown-error',
        });
      } catch {}
    }
    return ok;
  };

  try {
    if (!isValidGptInteractive({ interactive: inter })) return false;

    if (inter.type === 'buttons' && Array.isArray(inter.buttons)) {
      // Meta/Graph supports at most 3 reply buttons; if more, caller should use list
      const buttons = inter.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } }));
      const payload: any = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: inter.bodyText || 'Choose an action' },
          action: { buttons },
        },
      };
      return await sendAndConfirm(payload, 'buttons');
    }

    // For lists, use the central builder
    if (inter.type === 'list' && Array.isArray(inter.sections)) {
      const payload = buildInteractiveListPayload({
        to,
        bodyText: inter.bodyText || 'Choose an action',
        footerText: inter.footerText || undefined,
        buttonLabel: inter.buttonLabel || 'Choose',
        sections: inter.sections.map((s) => ({
          title: s.title || undefined,
          rows: s.rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
        })),
      });
      return await sendAndConfirm(payload as any, 'list');
    }
  } catch (e) {
    // swallow and fall back to text
  }
  return false;
}

export default {};
