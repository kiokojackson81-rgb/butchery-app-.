import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/server/supervisor/supervisor.notifications', () => ({
  notifyAttendants: vi.fn().mockResolvedValue(true),
  notifySupplier: vi.fn().mockResolvedValue(true),
}));

import * as pusherClient from '@/lib/pusher_client';
import { emitDepositConfirmed } from '@/lib/real_time';
import { notifyAttendants, notifySupplier } from '@/server/supervisor/supervisor.notifications';

describe('real_time pusher integration', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('falls back to notify helpers when no pusher', async () => {
    vi.spyOn(pusherClient, 'getPusher').mockReturnValue(null as any);
    const ok = await emitDepositConfirmed({ outletCode: 'BRIGHT', amount: 100 });
    expect(ok).toBe(true);
    expect((notifyAttendants as any)).toHaveBeenCalled();
    expect((notifySupplier as any)).toHaveBeenCalled();
  });

  it('uses pusher when present', async () => {
    const fakePusher = { trigger: vi.fn().mockResolvedValue(true) };
    vi.spyOn(pusherClient, 'getPusher').mockReturnValue(fakePusher as any);
    const ok = await emitDepositConfirmed({ outletCode: 'BRIGHT', amount: 200 });
    expect(ok).toBe(true);
    expect((fakePusher.trigger as any)).toHaveBeenCalledWith('outlet-BRIGHT', 'deposit_confirmed', expect.any(Object));
  });
});
