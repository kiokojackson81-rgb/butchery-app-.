import { describe, it, expect } from 'vitest';
import { composeWaMessage } from '@/lib/ai_util';

describe('login welcome dispatch', () => {
  it('returns deterministic attendant welcome with OOC', async () => {
    const res = await composeWaMessage({ kind: 'login_welcome', role: 'attendant', outlet: 'TestOutlet' });
    expect(res).toBeTruthy();
    expect(typeof res.text).toBe('string');
    const t = res.text || '';
    expect(t.length).toBeGreaterThan(10);
    expect(t).toContain('✅');
    expect(t).toContain('Welcome');
    expect(t).toContain('<<<OOC>');
    expect(t).toContain('"intent": "MENU"');
    expect(t).toContain('"buttons":');
  });
});
