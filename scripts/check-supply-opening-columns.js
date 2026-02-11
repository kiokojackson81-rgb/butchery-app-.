const { Client } = require('pg');
(async()=>{
  const conn = process.env.DATABASE_URL;
  if (!conn) { console.error('Missing DATABASE_URL'); process.exit(2); }
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const r = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='SupplyOpeningRow' AND column_name IN ('lockedAt','lockedBy')`);
    console.log('Found columns:', r.rows.map(r=>r.column_name));
  } catch(e){ console.error(e.message); process.exit(3); } finally { await client.end(); }
})();
