# Daraja Sandbox quickstart

Use these notes to run C2B RegisterURL and STK Push against Safaricom Daraja Sandbox without touching production.

## Endpoints

- Base URL: `https://sandbox.safaricom.co.ke`
- OAuth: `GET /oauth/v1/generate?grant_type=client_credentials`
- C2B RegisterURL: `POST /mpesa/c2b/v1/registerurl`
- STK Push: `POST /mpesa/stkpush/v1/processrequest`
- STK Query: `POST /mpesa/stkpushquery/v1/query`

## Requirements

- Sandbox Consumer Key/Secret for your app (from developer portal)
- Sandbox passkey for the shortcode you will use (commonly 174379 on sandbox)
- A publicly reachable callback URL (we default to `https://barakafresh.com`), or expose your local dev with a tunnel and set `PUBLIC_BASE_URL`

## One-off environment (optional)

If you want to run Next.js against Sandbox, set:

- `DARAJA_BASE_URL=https://sandbox.safaricom.co.ke`
- `DARAJA_CONSUMER_KEY=...`
- `DARAJA_CONSUMER_SECRET=...`
- `DARAJA_PASSKEY_HO=...` (sandbox passkey matching your shortcode)
- `PUBLIC_BASE_URL=https://barakafresh.com` (or your tunnel URL)

## PowerShell wrappers

Run these wrappers to hit sandbox endpoints using your sandbox credentials.

### Register C2B (sandbox)

```
pwsh ./scripts/register-c2b.sandbox.ps1 -ConsumerKey '<SANDBOX_CK>' -ConsumerSecret '<SANDBOX_CS>' -ShortCode '174379' -ConfirmUrl 'https://barakafresh.com/api/daraja/c2b/confirm' -ValidateUrl 'https://barakafresh.com/api/daraja/c2b/validate'
```

### STK Push (sandbox)

```
pwsh ./scripts/stk-push.sandbox.ps1 -ConsumerKey '<SANDBOX_CK>' -ConsumerSecret '<SANDBOX_CS>' -BusinessShortCode '174379' -Amount 5 -PhoneNumber '2547XXXXXXXX' -Passkey '<SANDBOX_PASSKEY>'
```

### STK Query (sandbox)

```
pwsh ./scripts/stk-query.sandbox.ps1 -ConsumerKey '<SANDBOX_CK>' -ConsumerSecret '<SANDBOX_CS>' -BusinessShortCode '174379' -CheckoutRequestID '<CHECKOUT_ID>' -Passkey '<SANDBOX_PASSKEY>'
```

Notes

- Ensure you include `?grant_type=client_credentials` in the OAuth URL.
- Child till RegisterURL attempts will fail in the same way as production; use HO or the sandbox shortcode.
- If callbacks fail due to reachability, set `PUBLIC_BASE_URL` to a tunnel URL and retry.
