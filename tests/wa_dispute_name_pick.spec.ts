import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory stores for prisma mocks
const sessions = new Map<string, any>();
const openingRows: any[] = [];
const productsByKey = new Map<string, { key: string; name: string }>();

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Prisma mock with minimal model-specific behavior we need
const prismaMock: any = {
  waSession: {
    findUnique: async ({ where: { phoneE164 } }: any) => sessions.get(phoneE164) || null,
    create: async ({ data }: any) => {
      const now = new Date();
      const rec = { id: `${Math.random().toString(36).slice(2)}`, state: 'SPLASH', cursor: { date: today(), rows: [] }, updatedAt: now, ...data };
      sessions.set(data.phoneE164, rec);
      return rec;
    },
    update: async ({ where: { id }, data }: any) => {
      for (const [k, v] of sessions.entries()) {
        if (v.id === id) {
          const updated = { ...v, ...data, updatedAt: new Date() };
          sessions.set(k, updated);
          return updated;
        }
      }
      return null;
    },
    upsert: async ({ where: { phoneE164 }, update, create }: any) => {
      const exists = sessions.get(phoneE164);
      if (exists) {
        const updated = { ...exists, ...update, updatedAt: new Date() };
        sessions.set(phoneE164, updated);
        return updated;
      }
      const now = new Date();
      const rec = { id: `${Math.random().toString(36).slice(2)}`, cursor: { date: today(), rows: [] }, updatedAt: now, ...create };
      sessions.set(phoneE164, rec);
      return rec;
    },
  },
  supplyOpeningRow: {
    findMany: async ({ where: { outletName, date } }: any) => {
      return openingRows.filter(r => r.outletName === outletName && r.date === date).map((r, idx) => ({ ...r, id: r.id ?? idx + 1 }));
    },
  },
  product: {
    findMany: async ({ where: { key: { in: keys } } }: any) => keys.map((k: string) => ({ key: k, name: productsByKey.get(k)?.name || k })),
  },
  reminderSend: { create: async () => ({}) },
  setting: { findUnique: async () => null, upsert: async () => ({}) },
  reviewItem: { findFirst: async () => null },
  attendantClosing: { findFirst: async () => null, findMany: async () => [] },
  phoneMapping: { findMany: async () => [] },
};

vi.doMock('@/lib/prisma', () => ({ prisma: prismaMock }));

// Mock WhatsApp senders to capture outputs
const sentTexts: Array<{ to: string; text: string }> = [];
vi.doMock('@/lib/wa', () => ({
  sendText: async (to: string, text: string) => { sentTexts.push({ to, text }); return null as any; },
  sendInteractive: async () => null as any,
  logOutbound: async () => null as any,
}));

// We'll import the function under test inside an isolated module context per test to avoid
// cross-file module cache binding to a non-mocked prisma instance.
let handleInboundText: (phone: string, text: string) => Promise<void>;

describe('attendant dispute pick-by-name', () => {
  const phone = '+254700000099';
  const outlet = 'TestOutlet';

  beforeEach(async () => {
    sentTexts.length = 0;
    openingRows.length = 0;
    productsByKey.clear();
    sessions.clear();
    // Reset module cache and re-apply mocks so our prisma/wa mocks bind before import
    vi.resetModules();
    vi.doMock('@/lib/prisma', () => ({ prisma: prismaMock }));
    vi.doMock('@/lib/wa', () => ({
      sendText: async (to: string, text: string) => { sentTexts.push({ to, text }); return null as any; },
      sendInteractive: async () => null as any,
      logOutbound: async () => null as any,
    }));
    const mod = await import('@/lib/wa_attendant_flow');
    handleInboundText = mod.handleInboundText;
    // Seed a session bound to outlet so the flow stays in MENU context
    sessions.set(phone, {
      id: 'sess1',
      phoneE164: phone,
      role: 'attendant',
      code: 'ATD1',
      outlet,
      state: 'MENU',
      cursor: { date: today(), rows: [] },
      updatedAt: new Date(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selects by exact product name and prompts for quantity', async () => {
    openingRows.push({ id: 1, outletName: outlet, date: today(), itemKey: 'GOAT', qty: 10, unit: 'kg' });
    productsByKey.set('GOAT', { key: 'GOAT', name: 'Goat' });

    await handleInboundText(phone, '1');
    await handleInboundText(phone, 'Goat');

    const last = sentTexts[sentTexts.length - 1]?.text || '';
    expect(last).toMatch(/Please enter the expected quantity/i);
    expect(last).toMatch(/Goat/);
  });

  it('shows ambiguity prompt when multiple matches', async () => {
    openingRows.push({ outletName: outlet, date: today(), itemKey: 'GOAT', qty: 5, unit: 'kg' });
    openingRows.push({ outletName: outlet, date: today(), itemKey: 'GOATLEG', qty: 3, unit: 'kg' });
    productsByKey.set('GOAT', { key: 'GOAT', name: 'Goat' });
    productsByKey.set('GOATLEG', { key: 'GOATLEG', name: 'Goat Leg' });

    await handleInboundText(phone, '1');
    await handleInboundText(phone, 'Go');

    const last = sentTexts[sentTexts.length - 1]?.text || '';
    expect(last).toMatch(/I found multiple matches/i);
    expect(last).toMatch(/1\)/);
  });

  it('guides when no matches found', async () => {
    openingRows.push({ outletName: outlet, date: today(), itemKey: 'BEEF', qty: 7, unit: 'kg' });
    productsByKey.set('BEEF', { key: 'BEEF', name: 'Beef' });

    await handleInboundText(phone, '1');
    await handleInboundText(phone, 'Fish');

    const last = sentTexts[sentTexts.length - 1]?.text || '';
    expect(last).toMatch(/I couldn't find "Fish"/i);
    expect(last).toMatch(/Reply with the number/i);
  });
});
