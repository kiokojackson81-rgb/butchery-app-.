export function parseStkCallback(payload: any) {
  const body = payload?.Body?.stkCallback || payload?.StkCallback || payload || {};
  const resultCode = Number(body?.ResultCode ?? body?.resultCode ?? -1);
  const merchantRequestId = body?.MerchantRequestID || body?.merchantRequestId || null;
  const checkoutRequestId = body?.CheckoutRequestID || body?.checkoutRequestId || null;

  let amount: number | null = null;
  let mpesaReceipt: string | null = null;
  let phone: string | null = null;

  const items = body?.CallbackMetadata?.Item || body?.callbackMetadata?.items || [];
  for (const it of items) {
    const name = String(it?.Name || it?.name || '').toLowerCase();
    const val = it?.Value ?? it?.value;
    if (!val) continue;
    if (name.includes('amount')) amount = Number(val);
    if (name.includes('mpesareceiptnumber') || name.includes('receipt')) mpesaReceipt = String(val);
    if (name.includes('phonenumber') || name.includes('phone')) phone = String(val);
  }

  return { resultCode, merchantRequestId, checkoutRequestId, amount, mpesaReceipt, phone, raw: payload };
}
