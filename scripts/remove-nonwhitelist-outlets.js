// Deletes all outlets and related data except those in the whitelist.
// Run only after taking a DB snapshot. Usage: set DATABASE_URL then
// node scripts/remove-nonwhitelist-outlets.js

const { Client } = require('pg');

const WHITELIST = ['barakaa', 'barakab'];

async function run() {
  const conn = process.env.DATABASE_URL;
  if (!conn) { console.error('Missing DATABASE_URL'); process.exit(2); }
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const res = await client.query('SELECT id, name, code FROM "Outlet"');
    const toDelete = res.rows.filter(r => !WHITELIST.includes(String(r.code).toLowerCase()));
    if (toDelete.length === 0) {
      console.log('No outlets to delete; whitelist intact.');
      await client.query('ROLLBACK');
      return;
    }
    console.log('Outlets to delete:', toDelete.map(r=>r.name+'('+r.code+')'));
    const outletIds = toDelete.map(r=>r.id);
    const outletNames = toDelete.map(r=>r.name);

    async function del(sql, params) {
      try {
        const r = await client.query(sql, params);
        console.log(sql.split('\n')[0].trim(), '→', r.rowCount, 'rows');
      } catch (e) {
        console.warn(sql.split('\n')[0].trim(), 'failed:', e.message);
      }
    }

    await del('DELETE FROM "PhoneMapping" WHERE outlet = ANY($1)', [outletNames]);
    await del('DELETE FROM "WaSession" WHERE outlet = ANY($1)', [outletNames]);
    await del('DELETE FROM "SupplyTransfer" WHERE "fromOutletName" = ANY($1) OR "toOutletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "PricebookRow" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "SupplyOpeningRow" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "SupplyRequest" WHERE "outlet" = ANY($1)', [outletNames]);
    await del('DELETE FROM "AttendantClosing" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "AttendantDeposit" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "AttendantExpense" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "AttendantTillCount" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "ActivePeriod" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "SupplyRecommendation" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "SupplyIntervalPerformance" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "DayClosePeriod" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "SupervisorCommission" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "ProductAssignment" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "AttendantKPI" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "ProductSupplyStat" WHERE "outletName" = ANY($1)', [outletNames]);
    await del('DELETE FROM "ReviewItem" WHERE "outlet" = ANY($1)', [outletNames]);

    const attendantsRes = await client.query('SELECT id FROM "Attendant" WHERE "outletId" = ANY($1)', [outletIds]);
    const attendantIds = attendantsRes.rows.map(r=>r.id);
    if (attendantIds.length > 0) {
      await del('DELETE FROM "LoginCode" WHERE "attendantId" = ANY($1)', [attendantIds]);
      await del('DELETE FROM "Session" WHERE "attendantId" = ANY($1)', [attendantIds]);
      await del('DELETE FROM "CommissionConfig" WHERE "attendantId" = ANY($1)', [attendantIds]);
        await del('DELETE FROM "Attendant" WHERE "id" = ANY($1)', [attendantIds]);
    }

    await del('DELETE FROM "AttendantAssignment" WHERE "outlet" = ANY($1)', [outletNames]);
    await del('DELETE FROM "Outlet" WHERE id = ANY($1)', [outletIds]);
    console.log('Deletion completed');
  } catch (e) {
    console.error('Error:', e.message);
    try { /* ignore rollback; not using transaction */ } catch(_) {}
    process.exit(4);
  } finally { await client.end(); }
}

run();
