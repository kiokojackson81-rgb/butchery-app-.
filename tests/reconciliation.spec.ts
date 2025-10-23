import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as recon from '@/lib/reconciliation';

describe('reconciliation helper', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns 0 when no closings', async () => {
    const mockClient: any = { attendantClosing: { findMany: vi.fn().mockResolvedValue([]) } };
    const val = await recon.computeExpectedDepositsForOutlet('BRIGHT', mockClient);
    expect(val).toBe(0);
  });
});
