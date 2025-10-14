#!/usr/bin/env tsx
/**
 * Batch recompute analytics for a date range (inclusive) optionally limited to one outlet.
 * Usage examples:
 *   tsx scripts/recompute-range.ts --start 2025-10-01 --end 2025-10-14
 *   tsx scripts/recompute-range.ts --start 2025-10-01 --end 2025-10-14 --outlet "Outlet A"
 *   SUPERVISOR_COMMISSION_RECOMPUTE=1 tsx scripts/recompute-range.ts -s 2025-09-24 -e 2025-10-10
 *   (dry run)
 *   tsx scripts/recompute-range.ts -s 2025-10-01 -e 2025-10-07 --dry-run
 */
import { recomputeAnalytics } from '@/lib/analytics/recompute.service';

function usage(exit = 0) {
  console.log(`recompute-range.ts
Arguments:
  --start YYYY-MM-DD  (required)
  --end   YYYY-MM-DD  (required)
  --outlet NAME       (optional single outlet)
  --dry-run           (do not persist writes)
  --sleep-ms N        (delay between days, default 0)
  -s / -e shorthand for --start/--end
Examples:
  tsx scripts/recompute-range.ts -s 2025-10-01 -e 2025-10-14
  SUPERVISOR_COMMISSION_RECOMPUTE=1 tsx scripts/recompute-range.ts --start 2025-09-24 --end 2025-10-10 --outlet "Outlet A"`);
  process.exit(exit);
}

function isDateKey(v: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(v); }

const args = process.argv.slice(2);
const argMap: Record<string, string | boolean> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith('-')) { argMap[key] = true; } else { argMap[key] = next; i++; }
  } else if (a === '-s') { argMap.start = args[++i]; }
  else if (a === '-e') { argMap.end = args[++i]; }
  else if (a === '-h' || a === '--help') usage(0);
}

const start = String(argMap.start || '');
const end = String(argMap.end || '');
if (!isDateKey(start) || !isDateKey(end)) {
  console.error('ERROR: --start and --end must be YYYY-MM-DD');
  usage(1);
}
if (end < start) {
  console.error('ERROR: end must be >= start');
  process.exit(1);
}
const outlet = typeof argMap.outlet === 'string' ? String(argMap.outlet) : undefined;
const dryRun = !!argMap['dry-run'];
const sleepMs = Number(argMap['sleep-ms'] || 0) || 0;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log(`[recompute-range] start=${start} end=${end} outlet=${outlet || '*'} dryRun=${dryRun} supervisorFlag=${process.env.SUPERVISOR_COMMISSION_RECOMPUTE === '1'} sleepMs=${sleepMs}`);
  const days: string[] = [];
  let cursor = new Date(start + 'T00:00:00.000Z');
  const endDate = new Date(end + 'T00:00:00.000Z');
  while (cursor.getTime() <= endDate.getTime()) {
    days.push(cursor.toISOString().slice(0,10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  let success = 0;
  for (const d of days) {
    const t0 = Date.now();
    try {
      const res = await recomputeAnalytics({ date: d, outlet: outlet || null, dryRun });
      success++;
      console.log(JSON.stringify({ date: d, elapsedMs: res.elapsedMs, outlets: res.outlets.length, supervisor: res.supervisor?.length || 0 }));
    } catch (e: any) {
      console.error(JSON.stringify({ date: d, error: String(e?.message || e) }));
    }
    if (sleepMs) await sleep(sleepMs);
  }
  console.log(`[recompute-range] done days=${days.length} success=${success}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
