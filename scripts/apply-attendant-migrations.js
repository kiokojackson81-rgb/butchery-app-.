// scripts/apply-attendant-migrations.js
// Execute the concatenated attendant-related SQL migrations against DATABASE_URL.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  try {
    const conn = process.env.DATABASE_URL;
    if (!conn) throw new Error('Missing DATABASE_URL');
    const sqlPath = path.join(__dirname, 'attendant-migrations-concat.sql');
    if (!fs.existsSync(sqlPath)) throw new Error('Missing attendant-migrations-concat.sql');
    let sql = fs.readFileSync(sqlPath, 'utf8');
    // Replace unsupported `CREATE TYPE IF NOT EXISTS` with guarded DO blocks
    // that check pg_type and EXECUTE the CREATE TYPE to be safe across Postgres versions.
    sql = sql.replace(/CREATE TYPE IF NOT EXISTS "public"\."([^"]+)"\s+AS ENUM\s*\(([^;]+?)\);/gms, (m, typeName, values) => {
      const typ = String(typeName || '').toLowerCase();
      // normalize values whitespace
      const vals = String(values || '').trim();
      return `DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${typ}') THEN\n    EXECUTE $$CREATE TYPE "public"."${typeName}" AS ENUM (${vals})$$;\n  END IF;\nEND\n$$;\n`;
    });
    const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await client.connect();
    console.log('Applying attendant migrations (this may take a while)...');
    // Split the large SQL into chunks based on migration markers so we can
    // identify failures and apply incrementally.
    const parts = sql.split(/(?=^-- =+ migration:)/m).filter(Boolean);
    await client.query('BEGIN');
    try {
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;
        console.log(`Executing chunk ${i + 1}/${parts.length} — preview:`, part.split('\n')[0].slice(0, 200));
        await client.query(part);
      }
      await client.query('COMMIT');
      console.log('Applied SQL from', sqlPath);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('Chunk execution failed:', e?.message || e);
      throw e;
    }
    await client.end();
  } catch (e) {
    console.error('ERROR', e?.message || e);
    process.exit(3);
  }
})();
