import { notifyAttendants, notifySupplier } from '@/server/supervisor/supervisor.notifications';
import { getPusher } from './pusher_client';

// Lightweight emitter: if a pusher or websocket exists, prefer it. Otherwise fallback to notify helpers.
export async function emitDepositConfirmed(payload: { outletCode: string; amount: number; msisdnMasked?: string; receipt?: string; date?: string }) {
  try {
    const pusher = getPusher();
    if (pusher) {
      await pusher.trigger(`outlet-${payload.outletCode}`, 'deposit_confirmed', payload);
      return true;
    }
    await notifyAttendants(payload.outletCode, `Deposit CONFIRMED: KSh ${payload.amount} (${payload.msisdnMasked || 'ref'})`);
    await notifySupplier(payload.outletCode, `Deposit CONFIRMED for ${payload.outletCode}: KSh ${payload.amount}`);
    return true;
  } catch (e:any) {
    console.error('[real_time] emit failed', String(e));
    return false;
  }
}
