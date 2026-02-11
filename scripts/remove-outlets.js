// scripts/remove-outlets.js
// Deletes outlets by code and related data. Run only after taking a DB snapshot.
// Usage: set DATABASE_URL and run: node scripts/remove-outlets.js

const { Client } = require('pg');

const TARGET_CODES = ['BRIGHT', 'BARAKA_C'];

async function run() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('Missing DATABASE_URL');
    process.exit(2);
  }
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query('BEGIN');

    const outletsRes = await client.query(`SELECT id, name, code FROM "Outlet" WHERE code = ANY($1)`, [TARGET_CODES]);
    if (outletsRes.rows.length === 0) {
      console.log('No outlets found for codes', TARGET_CODES);
      await client.query('ROLLBACK');
      return;
    }
    const outletIds = outletsRes.rows.map(r => r.id);
    const outletNames = outletsRes.rows.map(r => r.name);
    console.log('Found outlets:', outletsRes.rows);

    // Helper to run delete and log count
    async function del(sql, params) {
      const res = await client.query(sql, params);
      const count = res.rowCount || 0;
      console.log(`Deleted ${count} rows`);
      return count;
    }

    console.log('Deleting PhoneMapping rows...');
    await del('DELETE FROM "PhoneMapping" WHERE outlet = ANY($1)', [outletNames]);

    console.log('Deleting WaSession rows...');
    await del('DELETE FROM "WaSession" WHERE outlet = ANY($1)', [outletNames]);

    console.log('Deleting SupplyTransfer rows...');
    await del('DELETE FROM "SupplyTransfer" WHERE "fromOutletName" = ANY($1) OR "toOutletName" = ANY($1)', [outletNames]);

    console.log('Deleting PricebookRow rows...');
    await del('DELETE FROM "PricebookRow" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting SupplyOpeningRow rows...');
    await del('DELETE FROM "SupplyOpeningRow" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting SupplyRequest rows...');
    await del('DELETE FROM "SupplyRequest" WHERE "outlet" = ANY($1)', [outletNames]);

    console.log('Deleting AttendantClosing rows...');
    await del('DELETE FROM "AttendantClosing" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting AttendantDeposit rows...');
    await del('DELETE FROM "AttendantDeposit" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting AttendantExpense rows...');
    await del('DELETE FROM "AttendantExpense" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting AttendantTillCount rows...');
    await del('DELETE FROM "AttendantTillCount" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting ActivePeriod rows...');
    await del('DELETE FROM "ActivePeriod" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting SupplyRecommendation rows...');
    await del('DELETE FROM "SupplyRecommendation" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting SupplyIntervalPerformance rows...');
    await del('DELETE FROM "SupplyIntervalPerformance" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting DayClosePeriod rows...');
    await del('DELETE FROM "DayClosePeriod" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting SupervisorCommission rows...');
    await del('DELETE FROM "SupervisorCommission" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting PricebookRow backups if any...');
    // other tables referencing outletName/productKey

    console.log('Deleting ProductAssignment rows...');
    await del('DELETE FROM "ProductAssignment" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting AttendantKPI rows...');
    await del('DELETE FROM "AttendantKPI" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting ProductSupplyStat rows...');
    await del('DELETE FROM "ProductSupplyStat" WHERE "outletName" = ANY($1)', [outletNames]);

    console.log('Deleting ReviewItem rows... (outlet)');
    await del('DELETE FROM "ReviewItem" WHERE "outlet" = ANY($1)', [outletNames]);

    console.log('Deleting PhoneMapping rows for codes belonging to these outlets');
    // already deleted phone mappings by outlet above

    // Handle attendants: remove login codes, sessions, commission configs, then attendants
    const attendantsRes = await client.query('SELECT id FROM "Attendant" WHERE "outletId" = ANY($1)', [outletIds]);
    const attendantIds = attendantsRes.rows.map(r => r.id);
    if (attendantIds.length > 0) {
      console.log('Found attendants:', attendantIds.length);
      await del('DELETE FROM "LoginCode" WHERE "attendantId" = ANY($1)', [attendantIds]);
      await del('DELETE FROM "Session" WHERE "attendantId" = ANY($1)', [attendantIds]);
      await del('DELETE FROM "CommissionConfig" WHERE "attendantId" = ANY($1)', [attendantIds]);
      await del('DELETE FROM "Attendant" WHERE "id" = ANY($1)', [attendantIds]);
    } else {
      console.log('No attendants found for these outlets');
    }

    console.log('Deleting AttendantAssignment rows...');
    await del('DELETE FROM "AttendantAssignment" WHERE "outlet" = ANY($1)', [outletNames]);

    console.log('Deleting PersonCode rows where role/outlet related? (skipped)');

    console.log('Finally deleting Outlet rows...');
    await del('DELETE FROM "Outlet" WHERE id = ANY($1)', [outletIds]);

    await client.query('COMMIT');
    console.log('Removal complete');
  } catch (e) {
    console.error('Error during removal:', e.message);
    try { await client.query('ROLLBACK'); } catch(_) {}
    process.exit(4);
  } finally {
    await client.end();
  }
}

run();
