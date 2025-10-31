// Simple runner to initiate an STK push via our production API
// and poll for status to capture evidence.
// Usage: node scripts/run-stk.js

(async () => {
  // Allow overriding the target base URL for testing (e.g., http://localhost:3002)
  const base = process.env.BASE_URL || 'https://barakafresh.com';
  // Allow CLI args: phone amount outlet
  const [, , argPhone, argAmount, argOutlet, argMode] = process.argv;
  const payload = {
    outletCode: argOutlet || 'BRIGHT',
    phone: argPhone || '254705663175',
    amount: argAmount ? Number(argAmount) : 10,
    // Optional admin override for mode: BG_HO_SIGN | PAYBILL_HO | BG_PER_TILL
    ...(argMode ? { mode: String(argMode).toUpperCase() } : {}),
  };

  try {
  const res = await fetch(`${base.replace(/\/$/, '')}/api/pay/stk`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // If ADMIN_API_KEY is present locally, forward it for admin-only override
        ...(process.env.ADMIN_API_KEY ? { 'x-admin-key': process.env.ADMIN_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    console.log('STK push HTTP:', res.status);
    console.log('STK push body:', JSON.stringify(json));

    if (json?.ok && json?.data?.checkoutRequestId) {
      const id = json.data.checkoutRequestId;
      console.log('checkoutRequestId:', id);

      // Poll up to 9 times (~90s total) for status
      for (let i = 0; i < 9; i++) {
        await new Promise((r) => setTimeout(r, 10000));
  const q = await fetch(`${base.replace(/\/$/, '')}/api/pay/stk/query?checkout=${encodeURIComponent(id)}`);
        const qj = await q.json().catch(() => ({}));
        console.log(`Query[${i + 1}] HTTP:`, q.status);
        console.log(`Query[${i + 1}] body:`, JSON.stringify(qj));
        // Break early if we see a definitive result code in the query response
        const rc = qj?.data?.result?.ResultCode;
        if (typeof rc === 'number' || typeof rc === 'string') {
          // We have a terminal result (0 success, non-zero failure/cancel)
          break;
        }
      }
    } else {
      console.log('No checkoutRequestId returned; cannot poll.');
    }
  } catch (e) {
    console.error('run-stk error:', e?.message || e);
    process.exit(1);
  }
})();
