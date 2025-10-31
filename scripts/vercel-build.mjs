import { execSync } from 'node:child_process';

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: process.env });
}

// 1) Try to apply migrations in prod. If it fails (e.g., P3009), do NOT fail the build.
try {
  run('prisma migrate deploy');
} catch (e) {
  console.warn('warn: prisma migrate deploy failed. Skipping DB changes for this deploy.');
  const allowDbPush = process.env.ALLOW_DB_PUSH === '1';
  if (allowDbPush) {
    try {
      const acceptDataLoss = process.env.ACCEPT_DATA_LOSS === '1' ? ' --accept-data-loss' : '';
      run('prisma db push' + acceptDataLoss);
    } catch (e2) {
      console.warn('warn: prisma db push failed. Continuing without schema changes.');
    }
  }
}

// 2) Prebuild tasks (existing project hook)
run('node scripts/prebuild.mjs');

// 3) Next build
run('next build');
