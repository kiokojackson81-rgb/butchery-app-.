import { describe, it, expect } from 'vitest';
import { POST } from '@/app/api/admin/supply/route';

describe('admin supply route', () => {
  it('returns 400 when no rows provided', async () => {
    const req = new Request('http://localhost/api/admin/supply', { method: 'POST', body: JSON.stringify({}) });
    const res = (await POST(req as any)) as any;
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(res.status).toBe(400);
  });
});
