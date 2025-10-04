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

// Ensure Prisma client is generated before build.
// On Windows, antivirus or a running dev server can lock the DLL during rename.
// If on win32, skip generate entirely and rely on postinstall/dev having created the client already.
if (process.platform !== 'win32') {
  run('npx prisma generate', true);
} else {
  console.log('Skipping prisma generate on Windows to avoid DLL lock.');
}

if (isVercel) {
  console.log('Detected Vercel build environment. Skipping Prisma migrate steps to avoid advisory lock timeouts.');
} else {
  // Reconcile migration state if needed (ignore if IDs don't exist)
  run('npx prisma migrate resolve --rolled-back 20251001_change_attendantassignment_id');
  run('npx prisma migrate resolve --applied 20251001_change_attendantassignment_id_v2');
  run('npx prisma migrate resolve --rolled-back 20251001_refresh_code_view');

  // Apply any pending migrations (fail hard if this fails)
  run('npx prisma migrate deploy', false);
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
