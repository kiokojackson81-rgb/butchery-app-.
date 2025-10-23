import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/server/supervisor/supervisor.notifications', () => ({
  notifyAttendants: vi.fn().mockResolvedValue(true),
  notifySupplier: vi.fn().mockResolvedValue(true),
}));

import { emitDepositConfirmed } from '@/lib/real_time';
import { notifyAttendants, notifySupplier } from '@/server/supervisor/supervisor.notifications';

describe('real_time emitter', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('calls notify helpers and returns true on success', async () => {
    const ok = await emitDepositConfirmed({ outletCode: 'BRIGHT', amount: 500, msisdnMasked: '***678', receipt: 'R123' });
    expect(ok).toBe(true);
    expect((notifyAttendants as any)).toHaveBeenCalledWith('BRIGHT', expect.stringContaining('KSh 500'));
    expect((notifySupplier as any)).toHaveBeenCalledWith('BRIGHT', expect.stringContaining('KSh 500'));
  });
});
