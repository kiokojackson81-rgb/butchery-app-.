import { describe, it, expect } from 'vitest';
import { makePassword } from '@/lib/daraja_client';

describe('daraja_client makePassword', () => {
  it('builds base64 password with shortcode+passkey+timestamp', () => {
    const { password, timestamp } = makePassword('12345', 'abcde', '20220101120000');
    const decoded = Buffer.from(password, 'base64').toString('utf8');
    expect(decoded).toBe('12345abcde20220101120000');
    expect(timestamp).toBe('20220101120000');
  });
});
