import { describe, it, expect } from 'vitest';
import { validateOOC } from '@/lib/ooc_guard';

describe('ooc schema guard', () => {
  it('accepts canonical GPT-only menu ids', () => {
    const result = validateOOC({
      intent: 'ATT_CLOSING',
      buttons: ['ATT_CLOSING', 'ATT_DEPOSIT', 'MENU_SUMMARY'],
      next_state_hint: 'CLOSING_PICK',
      args: { outlet: 'CBD', amountKES: 1200 },
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects lowercase or unexpected characters', () => {
    const result = validateOOC({
      intent: 'att_closing',
      buttons: ['att_closing'],
      next_state_hint: 'menu-flow',
    });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('schema_invalid');
  });
});
