const fs = require('fs');
let sql = fs.readFileSync('scripts/attendant-migrations-concat.sql', 'utf8');
sql = sql.replace(/CREATE TYPE IF NOT EXISTS "public"\."([^"]+)"\s+AS ENUM\s*\(([^;]+?)\);/gms, (m, typeName, values) => {
  const typ = String(typeName || '').toLowerCase();
  const vals = String(values || '').trim();
  return `DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${typ}') THEN\n    EXECUTE $$CREATE TYPE "public"."${typeName}" AS ENUM (${vals})$$;\n  END IF;\nEND\n$$;\n`;
});
const parts = sql.split(/(?=^-- =+ migration:)/m).filter(Boolean);
console.log('PARTS:', parts.length);
console.log('--- CHUNK 2 PREVIEW ---');
console.log(parts[1].slice(0,1200));
