import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, hashToken, randomToken } from './token-crypto';

const key = randomBytes(32);

describe('secret encryption', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptSecret(key, 'refresh-token');
    const b = encryptSecret(key, 'refresh-token');
    expect(a).not.toBe(b);
    expect(decryptSecret(key, a)).toBe('refresh-token');
  });

  it('rejects tampered ciphertext', () => {
    const data = Buffer.from(encryptSecret(key, 'refresh-token'), 'base64url');
    data[data.length - 1]! ^= 1;
    expect(() => decryptSecret(key, data.toString('base64url'))).toThrow();
  });

  it('rejects another key and truncated input', () => {
    const encoded = encryptSecret(key, 'refresh-token');
    expect(() => decryptSecret(randomBytes(32), encoded)).toThrow();
    expect(() => decryptSecret(key, 'abc')).toThrow('Malformed secret');
  });
});

describe('session tokens', () => {
  it('are 32 random bytes stored only as a SHA-256 hex digest', () => {
    const token = randomToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
  });
});
