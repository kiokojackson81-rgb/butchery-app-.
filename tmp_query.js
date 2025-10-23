const { Client } = require('pg');
(async () => {
  try {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const res = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('prisma_migrations','SupervisorCommission');");
    console.log(JSON.stringify(res.rows, null, 2));
    await c.end();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
