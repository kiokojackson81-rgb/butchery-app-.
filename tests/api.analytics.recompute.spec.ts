import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/analytics/recompute/route';

vi.mock('@/lib/analytics/performance.service', () => ({
  computeOutletPerformance: vi.fn(async () => ({ ok: true })),
  computeAllOutletsPerformance: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/analytics/attendant-kpi.service', () => ({
  computeAllAttendantKPIs: vi.fn(async () => ({ ok: true })),
}));

describe('POST /api/analytics/recompute', () => {
  beforeEach(() => {
    (process as any).env.INTERNAL_API_KEY = 'secret';
  });

  it('rejects missing auth', async () => {
    const req = new Request('http://localhost/api/analytics/recompute', { method: 'POST', body: JSON.stringify({ date: '2025-10-14', outlet: 'Outlet A' }) });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it('rejects bad date', async () => {
    const req = new Request('http://localhost/api/analytics/recompute', { method: 'POST', body: JSON.stringify({ date: 'bad-date' }), headers: { 'x-internal-key': 'secret' } });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('BAD_DATE');
  });

  it('accepts valid single outlet recompute', async () => {
    const req = new Request('http://localhost/api/analytics/recompute', { method: 'POST', body: JSON.stringify({ date: '2025-10-14', outlet: 'Outlet A' }), headers: { 'x-internal-key': 'secret' } });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.outlet).toBe('Outlet A');
  });
});
