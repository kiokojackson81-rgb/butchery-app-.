const { Client } = require('pg');
(async()=>{
  const conn = process.env.DATABASE_URL;
  if (!conn) { console.error('Missing DATABASE_URL'); process.exit(2); }
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const r = await client.query('SELECT id, migration_name, finished_at, logs, started_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at DESC NULLS LAST');
    console.log('Found', r.rows.length, 'rows');
    for (const row of r.rows) {
      console.log('-', row.migration_name, 'started_at=', row.started_at, 'finished_at=', row.finished_at, 'applied_steps=', row.applied_steps_count);
    }
  } catch(e){ console.error(e.message); process.exit(3); } finally { await client.end(); }
})();
