const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await c.connect();
    await c.query('CREATE INDEX IF NOT EXISTS supervisorcommission_outlet_date_idx ON "SupervisorCommission" ("outletName", "date")');
    console.log('Index ensured');
    await c.end();
  } catch (e) {
    console.error(e);
    try { await c.end(); } catch {}
    process.exit(1);
  }
})();
