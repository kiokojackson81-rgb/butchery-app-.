const { Client } = require('pg');
(async ()=>{
  const conn = process.env.DATABASE_URL;
  if (!conn) { console.error('Missing DATABASE_URL'); process.exit(2); }
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const r = await client.query('SELECT id, name, code FROM "Outlet" ORDER BY name');
    console.log('Outlets:');
    for (const row of r.rows) console.log('-', row.name, '| code=', row.code, '| id=', row.id);

    const pc = await client.query('SELECT id, name, code, role FROM "PersonCode" ORDER BY code');
    console.log('\nPersonCodes:');
    for (const row of pc.rows) console.log('-', row.code, '| name=', row.name, '| role=', row.role, '| id=', row.id);

    const pm = await client.query('SELECT id, code, phoneE164, outlet FROM "PhoneMapping" ORDER BY outlet NULLS LAST, code');
    console.log('\nPhoneMappings (sample):');
    for (const row of pm.rows) console.log('-', row.code, '| phone=', row.phoneE164, '| outlet=', row.outlet, '| id=', row.id);
  } catch (e) {
    console.error(e.message);
    process.exit(3);
  } finally {
    await client.end();
  }
})();
