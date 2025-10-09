import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/wa', () => ({ sendText: vi.fn(), sendInteractive: vi.fn(), logOutbound: vi.fn() }));
vi.mock('@/server/wa_gate', () => ({ promptWebLogin: vi.fn() }));

import { POST } from '@/app/api/wa/webhook/route';
import { promptWebLogin } from '@/server/wa_gate';

describe('webhook SEND_LOGIN_LINK handling', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls promptWebLogin when SEND_LOGIN_LINK button is pressed', async () => {
    const body = {
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: '254700000000', type: 'interactive', interactive: { button_reply: { id: 'SEND_LOGIN_LINK' } } }] } }] }]
    };
    const req = new Request('https://example.com', { method: 'POST', body: JSON.stringify(body) });
    const res = await POST(req as any);
    expect(promptWebLogin).toHaveBeenCalled();
    expect(res).toBeTruthy();
  });
});
