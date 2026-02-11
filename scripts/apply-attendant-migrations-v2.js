// scripts/apply-attendant-migrations-v2.js
// More careful execution: split SQL into statements while respecting $$ quote blocks,
// then execute each statement sequentially to identify failures.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function preprocess(sql) {
  return sql.replace(/CREATE TYPE IF NOT EXISTS "public"\."([^"]+)"\s+AS ENUM\s*\(([^;]+?)\);/gms, (m, typeName, values) => {
    const vals = String(values || '').trim();
    return `DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE lower(typname) = lower('${typeName}')) THEN\n    EXECUTE $create$CREATE TYPE "public"."${typeName}" AS ENUM (${vals})$create$;\n  END IF;\nEND\n$$;\n`;
  });
}

function splitStatements(sql) {
  const stmts = [];
  let cur = '';
  let i = 0;
  let dollar = false;
  while (i < sql.length) {
    if (!dollar && sql.slice(i, i+2) === '$$') { dollar = true; cur += '$$'; i += 2; continue; }
    if (dollar && sql.slice(i, i+2) === '$$') { dollar = false; cur += '$$'; i += 2; continue; }
    const ch = sql[i];
    if (!dollar && ch === ';') {
      stmts.push(cur + ';');
      cur = '';
    } else {
      cur += ch;
    }
    i++;
  }
  if (cur.trim()) stmts.push(cur);
  return stmts.map(s => s.trim()).filter(Boolean);
}

(async () => {
  try {
    const conn = process.env.DATABASE_URL;
    if (!conn) throw new Error('Missing DATABASE_URL');
    const sqlPath = path.join(__dirname, 'attendant-migrations-concat.sql');
    if (!fs.existsSync(sqlPath)) throw new Error('Missing attendant-migrations-concat.sql');
    let sql = fs.readFileSync(sqlPath, 'utf8');
    sql = preprocess(sql);
    const statements = splitStatements(sql);
    console.log('Prepared', statements.length, 'statements');

    const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await client.connect();
    for (let idx = 0; idx < statements.length; idx++) {
      const s = statements[idx];
      console.log(`Executing statement ${idx+1}/${statements.length}:`, s.slice(0,200).replace(/\n/g,' '));
      try {
        await client.query(s);
      } catch (e) {
        console.error('Failed at statement', idx+1, 'error:', e.message);
        // Handle known COALESCE uuid/text mismatch by altering column to text and retrying
        if (e.message && e.message.includes('COALESCE types uuid and text') && /^UPDATE\s+/i.test(s) && /SET\s+"id"\s*=\s*COALESCE/i.test(s)) {
          const m = s.match(/UPDATE\s+"?public"?\."?([^"]+)"?/i);
          if (m && m[1]) {
            const table = m[1];
            console.log('Attempting automatic fix: alter column "id" to TEXT on table', table);
            try {
              await client.query(`ALTER TABLE "public"."${table}" ALTER COLUMN "id" TYPE TEXT USING ("id")::text;`);
              console.log('Altered column id to TEXT; retrying statement');
              await client.query(s);
              console.log('Retry succeeded');
              continue;
            } catch (e2) {
              console.error('Retry also failed:', e2.message);
            }
          }
        }
        console.error('Statement preview:', s.slice(0,800));
        throw e;
      }
    }
    console.log('All statements executed successfully');
    await client.end();
  } catch (e) {
    console.error('ERROR', e?.message || e);
    process.exit(4);
  }
})();
