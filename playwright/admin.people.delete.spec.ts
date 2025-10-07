import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Admin people delete persistence', () => {
  test.skip(!process.env.DATABASE_URL, 'Skipping admin persistence: DATABASE_URL not set');
  test.skip(({ browserName }) => browserName !== 'chromium', 'Run on a single project to avoid cross-project races');

  async function getBaseline(request: any) {
    const r = await request.get('/api/settings/admin_codes');
    expect(r.ok()).toBeTruthy();
    const data = await r.json();
    const list = Array.isArray(data?.value) ? data.value : [];
    return list as Array<{ code: string; role?: string; name?: string; active?: boolean; outlet?: string }>;
  }

  function toPerson(code: string, name: string) {
    return { code, role: 'attendant', name, active: false };
  }

  function hasCode(list: Array<{ code: string }>, code: string) {
    const target = String(code).toLowerCase();
    return list.some((x) => String(x?.code || '').toLowerCase() === target);
  }

  async function upsertPeople(request: any, people: any[]) {
    const r = await request.post('/api/admin/attendants/upsert', {
      data: { people },
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status(), ok: r.ok(), body: j } as const;
  }

  async function waitForCodePresence(request: any, code: string, present: boolean, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    const target = String(code).toLowerCase();
    do {
      const list = await getBaseline(request);
      const has = list.some((x) => String(x?.code || '').toLowerCase() === target);
      if (has === present) return true;
      await new Promise((r) => setTimeout(r, 300));
    } while (Date.now() < deadline);
    return false;
  }

  test('create → delete → cleanup without affecting others', async ({ request }) => {
    // 1) Baseline existing codes
    const baseline = await getBaseline(request);

    // Helper to merge baseline with new people
    const withBaseline = (extras: any[]) => [...baseline, ...extras];

    // 2) Generate two distinct, low-impact test codes with unique numeric cores
    const now = Date.now();
    const c1 = `ZZ${now % 1_000_000}A`;
    const c2 = `ZX${(now + 7) % 1_000_000}B`;

    // Avoid accidental duplicates with baseline
    expect(hasCode(baseline, c1)).toBeFalsy();
    expect(hasCode(baseline, c2)).toBeFalsy();

    // 3) Create both (merge baseline + our two)
  let res = await upsertPeople(request, withBaseline([toPerson(c1, 'Test A'), toPerson(c2, 'Test B')]));
  console.log('UPSERT-1', res.status, res.ok, res.body);
    // If digit-core collision with existing codes, retry once with different seeds
    if (res.status === 409) {
      const n2 = now + 1337;
      const c1b = `ZZ${n2 % 1_000_000}A`;
      const c2b = `ZX${(n2 + 7) % 1_000_000}B`;
      expect(hasCode(baseline, c1b)).toBeFalsy();
      expect(hasCode(baseline, c2b)).toBeFalsy();
  res = await upsertPeople(request, withBaseline([toPerson(c1b, 'Test A'), toPerson(c2b, 'Test B')]));
  console.log('UPSERT-1B', res.status, res.ok, res.body);
      expect(res.ok).toBeTruthy();
      // replace codes for subsequent checks
      (global as any).__codes = { c1: c1b, c2: c2b };
    } else {
      expect(res.ok).toBeTruthy();
      (global as any).__codes = { c1, c2 };
    }

    const { c1: code1, c2: code2 } = (global as any).__codes as { c1: string; c2: string };

  // Verify both present in settings mirror (with polling)
  expect(await waitForCodePresence(request, code1, true, 5000)).toBeTruthy();
  expect(await waitForCodePresence(request, code2, true, 5000)).toBeTruthy();

    // 4) Delete code2 by posting baseline + code1 only
  res = await upsertPeople(request, withBaseline([toPerson(code1, 'Test A')]));
  console.log('UPSERT-2', res.status, res.ok, res.body);
    expect(res.ok).toBeTruthy();

  // Verify code1 remains and code2 is gone (with polling)
  expect(await waitForCodePresence(request, code1, true, 5000)).toBeTruthy();
  expect(await waitForCodePresence(request, code2, false, 5000)).toBeTruthy();

    // 5) Cleanup: post baseline only to remove code1
  res = await upsertPeople(request, baseline);
  console.log('UPSERT-3', res.status, res.ok, res.body);
    expect(res.ok).toBeTruthy();

  const finalList = await getBaseline(request);
    expect(hasCode(finalList, code1)).toBeFalsy();
    expect(hasCode(finalList, code2)).toBeFalsy();

    // Also ensure we did not disturb any existing entries
    const baselineSet = new Set(baseline.map((x) => String(x.code).toLowerCase()));
    for (const row of finalList) {
      const lc = String(row.code || '').toLowerCase();
      expect(baselineSet.has(lc)).toBeTruthy();
    }
  });
});
