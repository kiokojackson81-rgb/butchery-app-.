import { test } from '@playwright/test';

test.describe('WA GPT interactive smoke (disabled)', () => {
  test.skip(true, 'GPT/OOC routing removed; suite disabled.');
});
