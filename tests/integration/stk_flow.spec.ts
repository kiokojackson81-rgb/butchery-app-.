import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll test the route logic by importing handlers and mocking dependencies
import * as stkRoute from '@/app/api/pay/stk/route';
import * as cbRoute from '@/app/api/mpesa/stk-callback/route';
import * as daraja from '@/lib/daraja_client';

vi.mock('@/lib/daraja_client');
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

describe('STK flow (unit-style)', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('makes a pending payment and calls daraja stkPush', async () => {
    // Mock request JSON
    const req = { json: async () => ({ outletCode: 'BRIGHT', phone: '254712345678', amount: 50 }) } as any as Request;
    // Mock prisma till and payment
    const mockTill = { storeNumber: '3574841', headOfficeNumber: '3574813', isActive: true };
    const mockPayment = { id: 'p1' };
    const prismaMock = { till: { findFirst: vi.fn().mockResolvedValue(mockTill) }, payment: { create: vi.fn().mockResolvedValue(mockPayment), update: vi.fn().mockResolvedValue({ id: 'p1' }) } } as any;
  // Inject mock prisma into route via setter
  (stkRoute as any).setPrisma(prismaMock);
    // Mock daraja push
    (daraja as any).stkPush.mockResolvedValue({ res: { MerchantRequestID: 'm1', CheckoutRequestID: 'c1' } });

    // Call handler
    const res = await (stkRoute as any).POST(req);
    expect((daraja as any).stkPush).toHaveBeenCalled();
  });

  it('callback creates orphan for unknown checkoutRequestId', async () => {
    const payload = { Body: { stkCallback: { ResultCode: 0, MerchantRequestID: 'mX', CheckoutRequestID: 'cX', CallbackMetadata: { Item: [{ Name: 'Amount', Value: 100 }, { Name: 'MpesaReceiptNumber', Value: 'R123' }, { Name: 'PhoneNumber', Value: '254700000000' }] } } } };
    const req = { json: async () => payload } as any as Request;
    const prismaMock = { payment: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'orphan1' }) } } as any;
  (cbRoute as any).setPrisma(prismaMock);
    const res = await (cbRoute as any).POST(req);
    expect(prismaMock.payment.create).toHaveBeenCalled();
  });
});
