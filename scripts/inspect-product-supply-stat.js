const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async function(){
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('Missing DATABASE_URL');
    process.exit(2);
  }
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const res = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name='ProductSupplyStat'
    `);
    console.log('ProductSupplyStat exists:', res.rows.length > 0);

    const migPath = path.join(__dirname, '..', 'prisma', 'migrations', '20251014_add_perf_indexes', 'migration.sql');
    if (fs.existsSync(migPath)) {
      console.log('\n--- migration.sql preview ---\n');
      const txt = fs.readFileSync(migPath,'utf8');
      console.log(txt.slice(0, 4000));
    } else {
      console.log('Migration file not found at', migPath);
    }

    const cols = await client.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ProductSupplyStat'
    `);
    console.log('\nColumns:', cols.rows);
  } catch(e){
    console.error(e.message);
    process.exit(3);
  } finally {
    await client.end();
  }
})();
