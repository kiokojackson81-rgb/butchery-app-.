const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const mig = process.argv[2];
if (!mig) {
  console.error('Usage: node apply-migration-file.js <migration_folder_name>');
  process.exit(2);
}
const filePath = path.join(__dirname, '..', 'prisma', 'migrations', mig, 'migration.sql');
if (!fs.existsSync(filePath)) {
  console.error('Migration file not found:', filePath);
  process.exit(3);
}
(async()=>{
  const sql = fs.readFileSync(filePath,'utf8');
  const conn = process.env.DATABASE_URL;
  if (!conn) { console.error('Missing DATABASE_URL'); process.exit(4); }
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log('Applying migration SQL from', filePath);
    await client.query(sql);
    console.log('Applied');
  } catch(e){
    console.error('Failed:', e.message);
    process.exit(5);
  } finally { await client.end(); }
})();
