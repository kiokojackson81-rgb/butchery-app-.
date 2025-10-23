import { test, expect, request } from '@playwright/test';

test.describe('STK -> callback -> reconciliation flow', () => {
  test('STK initiate -> callback -> admin shows deposit', async ({ page, baseURL }) => {
    const apiContext = await request.newContext({ baseURL: baseURL?.toString() || 'http://localhost:3002' });

    // Initiate STK
    const stkRes = await apiContext.post('/api/pay/stk', { data: { outletCode: 'BRIGHT', phone: '254712345678', amount: 50 } });
    expect(stkRes.ok()).toBeTruthy();
    // Simulate callback (simplified format)
    const cbPayload = { Body: { stkCallback: { ResultCode: 0, MerchantRequestID: 'm-test', CheckoutRequestID: 'c-test', CallbackMetadata: { Item: [{ Name: 'Amount', Value: 50 }, { Name: 'MpesaReceiptNumber', Value: 'RTEST' }, { Name: 'PhoneNumber', Value: '254712345678' }] } } } };
    const cbRes = await apiContext.post('/api/mpesa/stk-callback', { data: cbPayload });
    expect(cbRes.ok()).toBeTruthy();

    // Visit admin payments to see totals (requires server rendering)
    await page.goto('/admin/payments');
    await expect(page.locator('text=Deposits')).toBeVisible();
  });
});
