import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/wa', () => ({ sendText: vi.fn(), sendInteractive: vi.fn(), logOutbound: vi.fn() }));
vi.mock('@/lib/wa_log', () => ({ logMessage: vi.fn() }));

import { POST } from '@/app/api/wa/webhook/route';
import { sendText, sendInteractive, logOutbound } from '@/lib/wa';

describe('OOC logging and stripping', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('logs OOC into outbound meta and does not send OOC in message text', async () => {
    // Simulate an inbound message that triggers the GPT dry-run planner (deterministic OOC)
    const body = {
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: '254700000001', type: 'text', text: { body: 'hi' } }] } }] }]
    };

    const req = new Request('https://example.com', { method: 'POST', body: JSON.stringify(body) });
    const res = await POST(req as any);

    expect(res).toBeTruthy();

    // logOutbound should have been called to persist OOC metadata (at least once)
    expect((logOutbound as any).mock).toBeTruthy();
    const calls = (logOutbound as any).mock.calls;
    // find a call that includes meta.ooc
    const found = calls.find((c: any[]) => c[0] && c[0].payload && c[0].payload.meta && c[0].payload.meta.ooc);
    expect(found).toBeTruthy();

    // Ensure sendText/sendInteractive did not include raw OOC markers
    const sendTextCalls = (sendText as any).mock.calls;
    const sendInteractiveCalls = (sendInteractive as any).mock.calls;

    const anyTextHasOoc = sendTextCalls.some((c: any[]) => JSON.stringify(c).includes('<<<OOC>') || JSON.stringify(c).includes('</OOC>>>'));
    const anyInteractiveHasOoc = sendInteractiveCalls.some((c: any[]) => JSON.stringify(c).includes('<<<OOC>') || JSON.stringify(c).includes('</OOC>>>'));

    expect(anyTextHasOoc).toBe(false);
    expect(anyInteractiveHasOoc).toBe(false);
  });
});
