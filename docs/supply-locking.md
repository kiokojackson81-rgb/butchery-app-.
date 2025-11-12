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

QA tips:
- Submit a new item (qty > 0, buyPrice > 0) via dashboard; it should become locked immediately.
- Re-submit the same item same day via API; expect 409 locked.
- Submit the same item for tomorrow; expect a fresh locked row.
- Verify attendant closing respects opening-effective from yesterday closing + today supply.
