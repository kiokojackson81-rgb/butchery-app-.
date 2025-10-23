import { describe, it, expect } from 'vitest';
import { parseStkCallback } from '@/lib/mpesa_callback';

describe('parseStkCallback', () => {
  it('parses typical callback payload', () => {
    const payload = {
      Body: {
        stkCallback: {
          ResultCode: 0,
          MerchantRequestID: '123',
          CheckoutRequestID: 'ABC',
          CallbackMetadata: { Item: [ { Name: 'Amount', Value: 150 }, { Name: 'MpesaReceiptNumber', Value: 'XYZ123' }, { Name: 'PhoneNumber', Value: '254712345678' } ] }
        }
      }
    };
    const p = parseStkCallback(payload as any);
    expect(p.resultCode).toBe(0);
    expect(p.amount).toBe(150);
    expect(p.mpesaReceipt).toBe('XYZ123');
    expect(p.phone).toBe('254712345678');
  });
});
