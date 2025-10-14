This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Additional API Endpoints (Project Specific)

### POST /api/notify/supply

Send multi-role WhatsApp supply notifications (attendant, supplier, supervisor) with 24h free‑text gating.

Body example:

```json
{
	"payload": {
		"outlet": "Outlet A",
		"ref": "SUP-2024-10-14-1",
		"dateISO": "2025-10-14T08:15:00.000Z",
		"supplierName": "John",
		"attendantName": "Mary",
		"items": [
			{ "name": "Beef", "qty": 120.5, "unit": "kg", "unitPrice": 520 },
			{ "name": "Goat", "qty": 40 }
		]
	},
	"supplierCode": "SUP123",
	"templates": {
		"attendant": "supply_attendant",
		"supplier": "supply_supplier",
		"supervisor": "supply_supervisor"
	}
}
```

Behavior:

Response shape:
```json
{ "ok": true, "result": { "ok": true, "results": { "attendant": { /* send result */ }, "supervisor": { /* ... */ } } } }
```

Environment variables influencing this endpoint:

### POST /api/analytics/recompute

Recompute analytics (OutletPerformance + AttendantKPI) for a date. Auth required via `x-internal-key` if `INTERNAL_API_KEY` is set.

Body examples:
Single outlet:
```json
{ "date": "2025-10-14", "outlet": "Outlet A" }
```
All active outlets (omit outlet):
```json
{ "date": "2025-10-14" }
```

Responses:
`200 { ok: true, date, outlet }` or error with `{ ok: false, error }` (errors: `UNAUTHORIZED`, `BAD_DATE`).

Extended behavior:
- If environment variable `SUPERVISOR_COMMISSION_RECOMPUTE=1` the recompute will also upsert SupervisorCommission rows for each outlet/date (no WhatsApp notifications are sent).
- Response then includes a `supervisor` array summarizing per-outlet recompute:

Example dry-run (flag enabled):
```json
{
	"ok": true,
	"date": "2025-10-14",
	"dryRun": true,
	"outlets": [ { "outlet": "Outlet A", "outletPerformance": true, "attendantKPIs": true } ],
	"supervisor": [ { "outlet": "Outlet A", "supervisors": 2, "upserts": 0 } ],
	"elapsedMs": 123
}
```

Env flags summary:
- `INTERNAL_API_KEY`: required header `x-internal-key` for protected recompute call.
- `SUPERVISOR_COMMISSION_RECOMPUTE=1`: include supervisor commission upserts during recompute.

### Batch Recompute Script

For historical backfill across a date range use the helper script:

```
npm run recompute:range -- --start 2025-10-01 --end 2025-10-14
npm run recompute:range -- --start 2025-10-01 --end 2025-10-14 --outlet "Outlet A"
SUPERVISOR_COMMISSION_RECOMPUTE=1 npm run recompute:range -- -s 2025-09-24 -e 2025-10-10 --dry-run
```

Options:
- `--start YYYY-MM-DD` (required)
- `--end YYYY-MM-DD` (required)
- `--outlet NAME` limit to single outlet
- `--dry-run` skip persistence
- `--sleep-ms N` delay between day recomputes (throttle load)

Outputs one JSON line per day with elapsed ms and supervisor row count when enabled.


