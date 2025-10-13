import { test, expect } from '@playwright/test';

const base = process.env.BASE_URL || 'http://localhost:3002';
function url(p: string) { return `${base}${p}`; }

// This test hits the attendants upsert API directly with salary fields

test('admin attendants upsert with salary fields', async ({ request }) => {
  const today = new Date().toISOString().slice(0,10);
  const code = `T${Math.floor(Math.random()*100000)}`;
  const payload = {
    people: [
      { role: 'attendant', code, name: 'Test Att', active: true, outlet: 'TestOutlet', salaryAmount: 500, salaryFrequency: 'weekly' }
    ]
  };
  const res = await request.post(url('/api/admin/attendants/upsert'), { data: payload });
  expect(res.status()).toBeLessThan(500);
  const json = await res.json();
  expect(json).toHaveProperty('ok');
  expect(json.ok).toBeTruthy();
  // follow-up: ensure the attendant row reflects salary fields (optional, lenient)
});
