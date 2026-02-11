// scripts/db-inspect.js
// Inspect Postgres enum, prisma migrations, and key tables.
const { Client } = require('pg');
(async () => {
  try {
    const conn = process.env.DATABASE_URL;
    if (!conn) throw new Error('Missing DATABASE_URL');
    const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await client.connect();

    const qEnum = `SELECT n.nspname AS schema, t.typname AS type, e.enumlabel AS enum_value
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
LEFT JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname = 'personrole'
ORDER BY schema, type, enum_value;`;

    const qMigs = `SELECT migration_name, finished_at, applied_steps_count FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 20;`;

    const qTables = `SELECT to_regclass('public.PersonCode') as personcode_exists, to_regclass('public.Attendant') as attendant_exists, to_regclass('public.WaSession') as wasession_exists;`;

    const resEnum = await client.query(qEnum).catch((e) => { return { rows: [], error: String(e) }; });
    const resMigs = await client.query(qMigs).catch((e) => { return { rows: [], error: String(e) }; });
    const resTbl = await client.query(qTables).catch((e) => { return { rows: [], error: String(e) }; });

    console.log('--- ENUM personrole ---');
    if (resEnum.error) console.error(resEnum.error);
    console.log(JSON.stringify(resEnum.rows, null, 2));

    console.log('\n--- _prisma_migrations (recent) ---');
    if (resMigs.error) console.error(resMigs.error);
    console.log(JSON.stringify(resMigs.rows, null, 2));

    console.log('\n--- table existence ---');
    if (resTbl.error) console.error(resTbl.error);
    console.log(JSON.stringify(resTbl.rows, null, 2));

    await client.end();
  } catch (e) {
    console.error('ERROR', e?.message || e);
    process.exit(2);
  }
})();
