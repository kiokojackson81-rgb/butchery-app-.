#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

function run(cmd, allowFail = true) {
  try {
    console.log(`> ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    if (allowFail) {
      console.warn(`Command failed (ignored): ${cmd}`);
    } else {
      throw err;
    }
  }
}

const isVercel = !!process.env.VERCEL;
function isPooler(url) {
  return typeof url === 'string' && /pooler\./i.test(url);
}

// Ensure Prisma client is generated before build.
// On Windows, antivirus or a running dev server can lock the DLL during rename.
// If on win32, skip generate entirely and rely on postinstall/dev having created the client already.
if (process.platform !== 'win32') {
  run('npx prisma generate', true);
} else {
  console.log('Skipping prisma generate on Windows to avoid DLL lock.');
}

const DB_URL = process.env.DATABASE_URL || '';
const DB_UNPOOLED = process.env.DATABASE_URL_UNPOOLED || '';

if (isVercel) {
  console.log('Detected Vercel build environment. Skipping Prisma migrate steps to avoid advisory lock timeouts.');
} else {
  // If we do not have a direct URL or the URL points to a pooler, skip migrate to avoid P1002
  if (!DB_UNPOOLED || isPooler(DB_URL) || isPooler(DB_UNPOOLED)) {
    console.warn('Skipping Prisma migrate steps: missing DATABASE_URL_UNPOOLED or pooler URL detected.');
    console.warn('Set DATABASE_URL_UNPOOLED to a direct Postgres connection string (non-pooler) to apply migrations.');
  } else {
    // Reconcile migration state if needed (ignore if IDs don't exist)
    run('npx prisma migrate resolve --rolled-back 20251001_change_attendantassignment_id');
    run('npx prisma migrate resolve --applied 20251001_change_attendantassignment_id_v2');
    run('npx prisma migrate resolve --rolled-back 20251001_refresh_code_view');

    // Apply any pending migrations (fail hard if this fails)
    run('npx prisma migrate deploy', false);
  }
}

console.log('Prebuild complete.');

// Proactive cache cleanup before running Next build to avoid stale chunk resolution issues
try {
  const nextDir = join(process.cwd(), '.next');
  const turboDir = join(process.cwd(), '.turbo');
  rmSync(nextDir, { recursive: true, force: true });
  rmSync(turboDir, { recursive: true, force: true });
  console.log('Cleaned .next and .turbo caches.');
} catch (e) {
  // non-fatal
}
