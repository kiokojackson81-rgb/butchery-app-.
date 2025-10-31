import { execSync } from 'node:child_process';

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: process.env });
}

try {
  // 1) Try to apply migrations in prod
  run('prisma migrate deploy');
} catch (e) {
  console.warn('warn: prisma migrate deploy failed, falling back to prisma db push');
  try {
    // 2) Fallback to ensure schema is in place (non-destructive where possible)
    run('prisma db push');
  } catch (e2) {
    console.error('error: prisma db push also failed');
    process.exit(1);
  }
}

// 3) Prebuild tasks (existing project hook)
run('node scripts/prebuild.mjs');

// 4) Next build
run('next build');
