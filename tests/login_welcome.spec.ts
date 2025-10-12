import { describe, it, expect } from 'vitest';

// Skipped: this test asserted GPT/OOC behavior which is no longer part of the legacy-only flows.
describe.skip('login welcome dispatch (GPT/OOC removed)', () => {
  it('legacy-only mode — no OOC assertions', async () => {
    expect(true).toBe(true);
  });
});
