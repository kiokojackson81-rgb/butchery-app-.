const { Client } = require('pg');

// Scans text-like columns, views and index definitions for occurrences
// of outlets to delete. Does not mutate DB. Run with DATABASE_URL set.

const TO_REMOVE_NAMES = ['Baraka C','BarakaTest2','BrakaTest','Bright'];
const TO_REMOVE_CODES = ['barakac','barakatest2','barakatest','bright'];

function inListLower(val, list) {
  if (val == null) return false;
  const low = String(val).toLowerCase();
  return list.includes(low);
}

(async()=>{
  const conn = process.env.DATABASE_URL;
  if (!conn) { console.error('Missing DATABASE_URL'); process.exit(2); }
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log('Searching views for references...');
    const views = await client.query("SELECT table_name, view_definition FROM information_schema.views WHERE table_schema='public'");
    for (const v of views.rows) {
      const def = (v.view_definition||'').toLowerCase();
      for (const s of TO_REMOVE_NAMES.concat(TO_REMOVE_CODES)) {
        if (def.includes(s.toLowerCase())) console.log('VIEW MATCH:', v.table_name, 'contains', s);
      }
    }

    console.log('\nSearching index definitions for references...');
    const idxs = await client.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'");
    for (const i of idxs.rows) {
      const def = (i.indexdef||'').toLowerCase();
      for (const s of TO_REMOVE_NAMES.concat(TO_REMOVE_CODES)) {
        if (def.includes(s.toLowerCase())) console.log('INDEX MATCH:', i.indexname, 'contains', s);
      }
    }

    console.log('\nScanning tables for columns likely to reference outlets (outlet, outletname, code)');
    const cols = await client.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND data_type IN ('text','character varying')");
    const candidates = cols.rows.filter(r => /outlet|outletname|outlet_code|code$/i.test(r.column_name));
    const results = [];
    for (const c of candidates) {
      const q = `SELECT COUNT(*) AS cnt FROM "${c.table_name}" WHERE lower("${c.column_name}") = ANY($1)`;
      try {
        const r = await client.query(q, [TO_REMOVE_NAMES.map(x=>x.toLowerCase()).concat(TO_REMOVE_CODES)]);
        const cnt = Number(r.rows[0].cnt||0);
        if (cnt > 0) {
          console.log('TABLE MATCH:', c.table_name, c.column_name, '→', cnt, 'rows');
          results.push({table:c.table_name, column:c.column_name, count:cnt});
        }
      } catch (e) {
        // ignore per-table errors
      }
    }

    console.log('\nScanning all text columns for LIKE matches (this can be slow)');
    for (const c of cols.rows) {
      const tn = c.table_name; const cn = c.column_name;
      const q = `SELECT COUNT(*) AS cnt FROM "${tn}" WHERE lower("${cn}") LIKE ANY($1)`;
      try {
        const patterns = TO_REMOVE_NAMES.concat(TO_REMOVE_CODES).map(s => '%'+s.toLowerCase()+'%');
        const r = await client.query(q, [patterns]);
        const cnt = Number(r.rows[0].cnt||0);
        if (cnt > 0) console.log('LIKE MATCH:', tn, cn, '→', cnt, 'rows');
      } catch(e) { /* skip */ }
    }

    console.log('\nDone. Review matches above and decide whether to delete rows.');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(3);
  } finally { await client.end(); }
})();
