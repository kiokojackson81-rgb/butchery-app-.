// Script to apply assistant enum addition manually using Node pg
const { Client } = require('pg');

const MIGRATION_SQL = `DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_type t\n                 JOIN pg_enum e ON t.oid = e.enumtypid\n                 WHERE t.typname = 'PersonRole' AND e.enumlabel = 'assistant') THEN\n    ALTER TYPE "PersonRole" ADD VALUE 'assistant';\n  END IF;\nEND$$;`;

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    console.log('Connected to DB. Applying assistant enum migration...');
    await client.query(MIGRATION_SQL);
    console.log('Migration applied (or already present).');
  } catch (e) {
    console.error('Failed to apply migration:', e.message);
    process.exit(1);
  } finally {
    try { await client.end(); } catch {}
  }
})();
