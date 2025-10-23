const fs = require('fs');
const { Client } = require('pg');
(async () => {
  const sql = fs.readFileSync('scripts/attendant-migrations-concat.sql', 'utf8');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await c.connect();
    console.log('Connected. Executing SQL...');
    const res = await c.query(sql);
    console.log('Execution result:', res && res.command ? res.command : 'OK');
    await c.end();
    process.exit(0);
  } catch (e) {
    console.error('Error executing SQL:', e.message);
    console.error(e);
    try { await c.end(); } catch {}
    process.exit(1);
  }
})();
