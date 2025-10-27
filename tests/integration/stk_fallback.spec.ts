import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as stkRoute from '@/app/api/pay/stk/route';
import * as daraja from '@/lib/daraja_client';

vi.mock('@/lib/daraja_client');

describe('STK fallback behavior', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('falls back to GENERAL when outlet has no till and records payment with outlet GENERAL', async () => {
    const requestedOutlet = 'BARAKA_A';
    const req = { json: async () => ({ outletCode: requestedOutlet, phone: '254712345678', amount: 123 }) } as any as Request;

    // Mock prisma: first findFirst for requested outlet => null, second for GENERAL => returns general till
    const mockTillForRequested = null;
    const mockGeneralTill = { storeNumber: '3574871', headOfficeNumber: '3574811', outletCode: 'GENERAL', isActive: true };

    const tillFindFirst = vi.fn().mockImplementation(async ({ where }: any) => {
      if (where.outletCode === 'GENERAL') return mockGeneralTill;
      return null;
    });

    const createdPayment = { id: 'p-fallback', outletCode: 'GENERAL' };
    const paymentCreate = vi.fn().mockResolvedValue(createdPayment);
    const paymentUpdate = vi.fn().mockResolvedValue({ id: 'p-fallback' });

    const prismaMock = { till: { findFirst: tillFindFirst }, payment: { create: paymentCreate, update: paymentUpdate } } as any;
    (stkRoute as any).setPrisma(prismaMock);

    (daraja as any).stkPush.mockResolvedValue({ res: { MerchantRequestID: 'm1', CheckoutRequestID: 'c1' } });

    const res = await (stkRoute as any).POST(req);
    // The route returns a NextResponse; extract JSON
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.outletUsed).toBe('GENERAL');
    expect(json.fallback).toBe(true);
    // Ensure payment was created with outletCode GENERAL
    expect(paymentCreate).toHaveBeenCalled();
    const createdArg = paymentCreate.mock.calls[0][0];
    // Prisma create receives data object inside call
    if (createdArg && createdArg.data) {
      expect(createdArg.data.outletCode).toBe('GENERAL');
    }
    // Ensure daraja stkPush was called
    expect((daraja as any).stkPush).toHaveBeenCalled();
  });
});
