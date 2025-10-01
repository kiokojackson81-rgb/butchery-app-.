#!/usr/bin/env node
import { execSync } from 'node:child_process';

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

// Ensure Prisma client is generated before build
run('npx prisma generate', false);

// Reconcile migration state if needed (ignore if IDs don't exist)
run('npx prisma migrate resolve --rolled-back 20251001_change_attendantassignment_id');
run('npx prisma migrate resolve --applied 20251001_change_attendantassignment_id_v2');
run('npx prisma migrate resolve --rolled-back 20251001_refresh_code_view');

// Apply any pending migrations (fail hard if this fails)
run('npx prisma migrate deploy', false);

console.log('Prebuild complete.');
