import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

async function main(){
  const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!databaseUrl) {
    console.error('DATABASE_URL not set');
    process.exit(2);
  }

  const migrationPath = process.env.MIGRATION_SQL_PATH || 'prisma/migrations/add-tills-payments.manual.sql';
  const sqlPath = path.resolve(process.cwd(), migrationPath);
  if (!fs.existsSync(sqlPath)){
    console.error('manual SQL file not found at', sqlPath);
    process.exit(2);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client({ connectionString: databaseUrl });
  try{
    console.log('connecting to', databaseUrl.split('@')[1]);
    await client.connect();
    console.log('executing manual migration...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('migration applied successfully');
  } catch (e:any){
    console.error('migration failed:', e.message || e);
    try { await client.query('ROLLBACK'); } catch(_){ }
    process.exit(1);
  } finally{
    await client.end();
  }
}

main();
