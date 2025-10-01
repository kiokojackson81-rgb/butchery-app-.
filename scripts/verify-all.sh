#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[verify-all] Seeding canonical codes"
NODE_ENV=development npx tsx scripts/seed-login-codes.ts >/dev/null
NODE_ENV=development npx tsx scripts/seed-attendant-code.ts >/dev/null
NODE_ENV=development npx tsx scripts/seedAssignments.ts >/dev/null

echo "[verify-all] Exercising auth endpoints with casing/spacing variants"
NODE_ENV=development npx tsx scripts/test-auth.ts

echo "[verify-all] Checking Prisma health"
NODE_ENV=development node scripts/checkDb.mjs

echo "[verify-all] Ensuring indexes exist"
NODE_ENV=development node scripts/show-indexes.mjs

echo "[verify-all] Verifying digit-core collisions via SQL"
NODE_ENV=development npx tsx scripts/check-code-collisions.ts

echo "[verify-all] Running Vitest collision spec"
NODE_ENV=development npx vitest run tests/collision.upsert.spec.ts --run

echo "[verify-all] All verification checks completed successfully."
