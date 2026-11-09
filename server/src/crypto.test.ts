import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto.ts';

const key = randomBytes(32).toString('base64');

describe('secret encryption', () => {
  it('round-trips a secret', () => {
    expect(decrypt(encrypt('1//refresh-token', key), key)).toBe('1//refresh-token');
  });

  it('never stores the clear text', () => {
    expect(encrypt('1//refresh-token', key)).not.toContain('refresh');
  });

  it('rejects a tampered blob, even when the character changed was an A', () => {
    // The random IV makes that character an A about once in 64: drawn until it is, the test no longer depends on it.
    let blob = encrypt('secret', key);
    while (blob.at(-2) !== 'A') blob = encrypt('secret', key);
    const tampered = blob.slice(0, -2) + (blob.at(-2) === 'A' ? 'B' : 'A') + blob.slice(-1);
    expect(tampered).not.toBe(blob);
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encrypt('secret', randomBytes(16).toString('base64'))).toThrow(/32/);
  });
});
