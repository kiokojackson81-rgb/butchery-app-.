import { describe, it, expect } from 'vitest';
import { composeWaMessage } from '@/lib/ai_util';

describe('login welcome dispatch', () => {
  it('returns deterministic attendant welcome with OOC', async () => {
    const res = await composeWaMessage({ kind: 'login_welcome', role: 'attendant', outlet: 'TestOutlet' });
    expect(res).toBeTruthy();
    expect(typeof res.text).toBe('string');
    const t = res.text || '';
    expect(t.length).toBeGreaterThan(10);
    expect(t).toContain('Welcome back TestOutlet attendant');
    // OOC should be returned separately and not embedded in text
    expect(typeof res.ooc).toBe('string');
    expect(res.ooc).toContain('"intent": "MENU"');
    expect(res.ooc).toContain('"next_state_hint": "GPT"');
    expect(Array.isArray(res.buttons)).toBe(true);
    expect(res.buttons).toHaveLength(0);
  });
});
