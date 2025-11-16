// tests/api.supervisor.commissions.update-status.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as updateStatus } from '@/app/api/supervisor/commissions/update-status/route';
import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const store: any[] = [];
  return {
    prisma: {
      supervisorCommission: {
        findUnique: vi.fn(async ({ where }: any) => store.find(r => r.date === where.date_outletName.date && r.outletName === where.date_outletName.outletName) || null),
        update: vi.fn(async ({ where, data }: any) => { const i = store.findIndex(r => r.id === where.id); store[i] = { ...store[i], ...data, updatedAt: new Date() }; return store[i]; }),
        create: vi.fn(async ({ data }: any) => { const rec = { id: 'ID'+(store.length+1), createdAt: new Date(), updatedAt: new Date(), ...data }; store.push(rec); return rec; })
      }
    }
  };
});

function req(body: any) {
  return new NextRequest('http://localhost/api/supervisor/commissions/update-status', { method: 'POST', body: JSON.stringify(body) });
}

describe('update-status commission workflow', () => {
  beforeEach(() => {
    (prisma as any).supervisorCommission.findUnique.mockClear();
    (prisma as any).supervisorCommission.update.mockClear();
    (prisma as any).supervisorCommission.create.mockClear();
  });

  it('creates CALCULATED to APPROVED and sets approvedAt', async () => {
    const r1 = await updateStatus(req({ date: '2025-11-16', outletName: 'OutletX', status: 'APPROVED' }));
    const j1 = await r1.json();
    expect(j1.ok).toBe(true);
    expect(j1.record.status).toBe('APPROVED');
    expect(j1.record.approvedAt).toBeTruthy();
    expect(j1.record.paidAt).toBeFalsy();
  });

  it('transitions APPROVED to PAID sets paidAt and preserves approvedAt', async () => {
    const r1 = await updateStatus(req({ date: '2025-11-16', outletName: 'OutletY', status: 'APPROVED' }));
    const j1 = await r1.json();
    const approvedAtFirst = j1.record.approvedAt;
    const r2 = await updateStatus(req({ date: '2025-11-16', outletName: 'OutletY', status: 'PAID' }));
    const j2 = await r2.json();
    expect(j2.ok).toBe(true);
    expect(j2.record.status).toBe('PAID');
    expect(j2.record.paidAt).toBeTruthy();
    expect(j2.record.approvedAt).toBe(approvedAtFirst);
  });
});
