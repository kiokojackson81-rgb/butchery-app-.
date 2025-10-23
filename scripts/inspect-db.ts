import { Client } from 'pg';

async function main(){
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Please set DATABASE_URL');
    process.exit(2);
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try{
    const enums = await client.query(`SELECT n.nspname as schema, t.typname as name
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname IN ('outletcode','paymentstatus') OR t.typname IN (SELECT typname FROM pg_type WHERE typname ILIKE 'OutletCode' OR typname ILIKE 'PaymentStatus')`);

    const tables = await client.query(`SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN ('Till','Payment')`);

    const views = await client.query(`SELECT table_schema, table_name FROM information_schema.views WHERE table_name='vw_codes_norm'`);

    console.log('enums:', enums.rows);
    console.log('tables:', tables.rows);
    console.log('views:', views.rows);
  } catch (e:any){
    console.error('inspect error', e.message || e);
    process.exit(1);
  } finally{
    await client.end();
  }
}

main();
