const { Client } = require('pg');

// Deletes residual rows that reference removed outlets. Run only after backup.
const TO_REMOVE_NAMES = ['Baraka C','BarakaTest2','BrakaTest','Bright'];
const TO_REMOVE_CODES = ['barakac','barakatest2','barakatest','bright'];

(async()=>{
  const conn = process.env.DATABASE_URL;
  if (!conn) { console.error('Missing DATABASE_URL'); process.exit(2); }
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const namesLower = TO_REMOVE_NAMES.map(s=>s.toLowerCase());
    const codesLower = TO_REMOVE_CODES.map(s=>s.toLowerCase());
    const patterns = namesLower.concat(codesLower).map(s=>`%${s}%`);

    async function runDel(sql, params) {
      try {
        const r = await client.query(sql, params);
        console.log(sql.split('\n')[0].trim(), '→', r.rowCount, 'rows');
      } catch (e) {
        console.warn('Failed:', sql.split('\n')[0].trim(), e.message);
      }
    }

    console.log('Deleting from Session where outletCode references removed outlets');
    await runDel('DELETE FROM "Session" WHERE lower("outletCode") = ANY($1) OR lower("outletCode") LIKE ANY($2)', [codesLower.concat(namesLower), patterns]);

    console.log('Deleting from OpsEvent where outlet_id or dedupe_key references removed outlets');
    await runDel('DELETE FROM "OpsEvent" WHERE lower("outlet_id") = ANY($1) OR lower("dedupe_key") LIKE ANY($2)', [codesLower.concat(namesLower), patterns]);

    console.log('Deleting from AttendantScope where outletName/codeNorm reference removed outlets');
    await runDel('DELETE FROM "AttendantScope" WHERE lower("outletName") = ANY($1) OR lower("codeNorm") LIKE ANY($2)', [codesLower.concat(namesLower), patterns]);

    console.log('Deleting from Setting where key mentions removed outlets');
    await runDel('DELETE FROM "Setting" WHERE lower(key) LIKE ANY($1)', [patterns]);

    console.log('Deleting from AppState where key mentions removed outlets');
    await runDel('DELETE FROM "AppState" WHERE lower(key) LIKE ANY($1)', [patterns]);

    console.log('Completed deletion of targeted residual references.');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(3);
  } finally { await client.end(); }
})();
