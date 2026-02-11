const { Client } = require('pg');

(async () => {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('Missing DATABASE_URL');
    process.exit(2);
  }
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const sql = `
    CREATE TABLE IF NOT EXISTS "public"."ProductSupplyStat" (
      "id" text PRIMARY KEY,
      "date" text NOT NULL,
      "outletName" text NOT NULL,
      "productKey" text NOT NULL,
      "salesQty" double precision NOT NULL DEFAULT 0,
      "wasteQty" double precision NOT NULL DEFAULT 0,
      "openingQty" double precision NOT NULL DEFAULT 0,
      "supplyQty" double precision NOT NULL DEFAULT 0,
      "closingQty" double precision NOT NULL DEFAULT 0,
      "ma7_salesQty" double precision,
      "ma14_salesQty" double precision,
      "leadTimeDays" integer,
      "safetyStock" double precision,
      "reorderPoint" double precision,
      "parLevel" double precision,
      "currentIntervalId" text,
      "intervalDayIndex" integer,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "ProductSupplyStat_unique" ON "public"."ProductSupplyStat" ("date", "outletName", "productKey");
    CREATE INDEX IF NOT EXISTS "ProductSupplyStat_outlet_date_idx" ON "public"."ProductSupplyStat" ("outletName", "date");
    CREATE INDEX IF NOT EXISTS "ProductSupplyStat_product_date_idx" ON "public"."ProductSupplyStat" ("productKey", "date");
    `;
    console.log('Creating ProductSupplyStat table if missing...');
    await client.query(sql);
    console.log('Done');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(3);
  } finally {
    await client.end();
  }
})();
