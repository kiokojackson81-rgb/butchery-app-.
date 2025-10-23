const { Client } = require('pg');
(async ()=>{
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const res1 = await c.query("SELECT migration_name, finished_at, applied_steps_count, logs FROM \"_prisma_migrations\" ORDER BY finished_at DESC LIMIT 50;");
  console.log('MIGRATIONS:', JSON.stringify(res1.rows, null, 2));
  const res2 = await c.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND (tablename ILIKE '%supervisor%' OR tablename ILIKE '%commission%') ORDER BY tablename;");
  console.log('TABLES:', JSON.stringify(res2.rows, null, 2));
  await c.end();
})().catch(e=>{ console.error('ERR', e.message); process.exit(1); });
