# Supply per-item locking

This app enforces per-item locking for opening supply rows:

- Each SupplyOpeningRow is unique by (date, outletName, itemKey).
- When a supplier submits an item (via Supplier Dashboard Submit or WA Supplier flow), the row is saved with lockedAt/lockedBy.
- Once locked, that row cannot be modified via bulk draft updates or repeat submissions for the same date/outlet/item.
- Locking is per trading period (calendar day). A new day creates a new row which starts unlocked.
- Supervisors can still apply adjustments through the review queue (which records the actor in lockedBy on first lock).

Impacts:
- Supplier Dashboard shows a “Locked” pill and disables editing/removal for locked rows.
- WhatsApp Supplier flow replies with “Saved & locked …” and prevents repeat submissions for locked items.
- Attendant flows use the locked opening in opening-effective calculations for sales and deposit recommendations.

APIs involved:
- POST /api/supply/opening (draft writes only; ignores locked rows)
- POST /api/supply/opening/item (per-item submit+lock)
- GET  /api/supply/opening (reflects locked status)

Admin controls (panel):
- Admin → Supply & Reports → Supply View now includes admin-only actions:
	- Unlock Day: POST `/api/admin/supply/unlock-day` with `{ date, outlet }` clears the soft day-lock (Setting `lock:supply:<DATE>:<Outlet>`). This reopens the supplier UI without touching per-item locks.
	- Unlock All Rows: POST `/api/admin/supply/unlock-all` with `{ date, outlet }` clears `lockedAt/lockedBy` on all SupplyOpeningRow items for that day/outlet (quantities remain unchanged).
	- Submit Row: POST `/api/admin/supply` with `{ rows: [{ date, outletName, itemKey, qty, buyPrice, unit }] }` mirrors supplier submit and writes a locked row. Use this to enter supply directly from admin.

Notes:
- Admins should use the Admin panel for unlocking or submitting; “Admin mode” in the Supplier dashboard has been removed to avoid mixed responsibilities.
- Day-lock status is surfaced to the Supplier UI via `GET /api/supply/day-lock` and does not auto-clear per-item locks.

QA tips:
- Submit a new item (qty > 0, buyPrice > 0) via dashboard; it should become locked immediately.
- Re-submit the same item same day via API; expect 409 locked.
- Submit the same item for tomorrow; expect a fresh locked row.
- Verify attendant closing respects opening-effective from yesterday closing + today supply.
- Toggle day lock from Admin Supply View, verify Supplier UI shows locked/unlocked banner accordingly.
- Use Unlock All Rows then confirm items become editable again on next Supplier sync, quantities preserved.
