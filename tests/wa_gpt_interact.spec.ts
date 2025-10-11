import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/wa', () => ({
  sendInteractive: vi.fn(async () => ({ ok: true })),
}));

import { sendInteractive } from '@/lib/wa';
import { trySendGptInteractive } from '@/lib/wa_gpt_interact';

const mockSendInteractive = sendInteractive as unknown as ReturnType<typeof vi.fn>;

describe('trySendGptInteractive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats noop interactive responses as failure so callers can fall back', async () => {
    (mockSendInteractive as any).mockResolvedValueOnce({ ok: true, response: { noop: true } });
    const sent = await trySendGptInteractive('254700000000', {
      type: 'buttons',
      buttons: [
        { id: 'ONE', title: 'One' },
        { id: 'TWO', title: 'Two' },
      ],
    } as any);
    expect(sent).toBe(false);
  });

  it('returns true for successful interactive sends', async () => {
    (mockSendInteractive as any).mockResolvedValueOnce({ ok: true, response: { messages: [{ id: 'wamid' }] } });
    const sent = await trySendGptInteractive('254700000001', {
      type: 'buttons',
      buttons: [
        { id: 'A', title: 'Option A' },
      ],
    } as any);
    expect(sent).toBe(true);
  });
});
