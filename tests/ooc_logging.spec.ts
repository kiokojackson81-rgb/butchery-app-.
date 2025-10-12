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

  // Skipped: OOC logging/stripping relied on GPT-generated OOC blocks which have been removed.
  describe.skip('OOC logging and stripping (removed with GPT)', () => {
    it('legacy-only mode — no OOC', async () => {
      expect(true).toBe(true);
    });
  });
});
