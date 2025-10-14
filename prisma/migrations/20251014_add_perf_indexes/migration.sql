-- Performance indexes added via schema.prisma update (2025-10-14)
-- Safe to run multiple times using IF NOT EXISTS guards.

-- PhoneMapping composite & phone index
CREATE INDEX IF NOT EXISTS "PhoneMapping_role_outlet_idx" ON "PhoneMapping" ("role", "outlet");
CREATE INDEX IF NOT EXISTS "PhoneMapping_phoneE164_idx" ON "PhoneMapping" ("phoneE164");

-- WaMessageLog temporal & direction indexes
CREATE INDEX IF NOT EXISTS "WaMessageLog_createdAt_idx" ON "WaMessageLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "WaMessageLog_direction_createdAt_idx" ON "WaMessageLog" ("direction", "createdAt");

-- AttendantKPI outlet-date and attendant-date indexes
CREATE INDEX IF NOT EXISTS "AttendantKPI_outlet_date_idx" ON "AttendantKPI" ("outletName", "date");
CREATE INDEX IF NOT EXISTS "AttendantKPI_attendant_date_idx" ON "AttendantKPI" ("attendantId", "date");

-- ProductSupplyStat outlet-date and product-date indexes
CREATE INDEX IF NOT EXISTS "ProductSupplyStat_outlet_date_idx" ON "ProductSupplyStat" ("outletName", "date");
CREATE INDEX IF NOT EXISTS "ProductSupplyStat_product_date_idx" ON "ProductSupplyStat" ("productKey", "date");
