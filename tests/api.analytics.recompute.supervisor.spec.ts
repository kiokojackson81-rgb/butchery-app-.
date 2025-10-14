import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/analytics/recompute/route';

// Mock underlying analytics services
vi.mock('@/lib/analytics/performance.service', () => ({
  computeOutletPerformance: vi.fn(async () => ({ ok: true })),
  listDistinctOutlets: vi.fn(async () => ['Outlet A', 'Outlet B']),
}));
vi.mock('@/lib/analytics/attendant-kpi.service', () => ({
  computeAllAttendantKPIs: vi.fn(async () => ({ ok: true })),
}));
// Mock supervisor commission recompute service
const recomputeSpy = vi.fn(async (_date: string, outlet: string) => ({ outlet, supervisors: 1, upserts: 1 }));
vi.mock('@/lib/analytics/supervisor-commission.service', () => ({
  recomputeSupervisorCommission: (date: string, outlet: string) => recomputeSpy(date, outlet),
}));

describe('POST /api/analytics/recompute supervisor commission integration', () => {
  beforeEach(() => {
    (process as any).env.INTERNAL_API_KEY = 'secret';
    delete (process as any).env.SUPERVISOR_COMMISSION_RECOMPUTE; // default off
  });

  it('does not include supervisor summary when flag disabled', async () => {
    const req = new Request('http://localhost/api/analytics/recompute', { method: 'POST', body: JSON.stringify({ date: '2025-10-14', dryRun: true }), headers: { 'x-internal-key': 'secret' } });
    const res = await POST(req as any);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.supervisor).toBeUndefined();
  });

  it('includes supervisor summary when flag enabled', async () => {
    (process as any).env.SUPERVISOR_COMMISSION_RECOMPUTE = '1';
    const req = new Request('http://localhost/api/analytics/recompute', { method: 'POST', body: JSON.stringify({ date: '2025-10-14', dryRun: true }), headers: { 'x-internal-key': 'secret' } });
    const res = await POST(req as any);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.supervisor)).toBe(true);
  });
});
