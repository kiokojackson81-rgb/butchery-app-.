import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma to avoid requiring DATABASE_URL for unit tests
const prismaMock = new Proxy({}, { get: (_, prop) => ({ findFirst: async () => null, findUnique: async () => null, findMany: async () => [], update: async () => null, upsert: async () => null, create: async () => null, deleteMany: async () => null, $transaction: async (fn: any) => typeof fn === 'function' ? await fn(prismaMock) : null }) });
vi.doMock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.doMock('@/lib/wa', () => ({ sendText: vi.fn(), sendInteractive: vi.fn(), logOutbound: vi.fn() }));
vi.doMock('@/lib/wa_log', () => ({ logMessage: vi.fn() }));

vi.doMock('@/lib/gpt_router', () => ({ runGptForIncoming: async (phone: string, text: string) => {
  return `Hi there\n<<<OOC>${JSON.stringify({ intent: 'MENU', buttons: ['ATT_DEPOSIT'] })}</OOC>>>`;
}}));

// Dynamically import route and wa after mocks to ensure mocks apply

describe('OOC logging and stripping', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('logs OOC into outbound meta and does not send OOC in message text', async () => {
    // Simulate an inbound message that triggers the GPT dry-run planner (deterministic OOC)
    const body = {
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: '254700000001', type: 'text', text: { body: 'hi' } }] } }] }]
    };

  const route = await import('@/app/api/wa/webhook/route');
  const wa = await import('@/lib/wa');
  const { POST } = route as any;
  const { sendText, sendInteractive, logOutbound } = wa as any;
  const req = new Request('https://example.com', { method: 'POST', body: JSON.stringify(body) });
  const res = await POST(req as any);

    expect(res).toBeTruthy();

    // logOutbound should have been called to persist OOC metadata (at least once)
  expect((logOutbound as any).mock).toBeTruthy();
  const calls = (logOutbound as any).mock.calls;
    // find a call that includes meta.ooc or is typed as OOC_INFO
    const found = calls.find((c: any[]) => {
      const arg = c && c[0];
      if (!arg) return false;
      if (arg.type === 'OOC_INFO') return true;
      if (arg.payload && arg.payload.meta && arg.payload.meta.ooc) return true;
      return false;
    });
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
