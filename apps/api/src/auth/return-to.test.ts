import { describe, expect, it } from 'vitest';
import { sanitizeReturnTo } from './return-to';

describe('sanitizeReturnTo', () => {
  it.each(['/', '/history', '/history?month=2026-10#top', '/a/b/c'])('keeps %s', (path) => {
    expect(sanitizeReturnTo(path)).toBe(path);
  });

  it.each([
    undefined,
    '',
    'history',
    '//evil.example',
    '/\\evil.example',
    'https://evil.example/',
    'javascript:alert(1)',
    '/\t/evil.example',
    '/\n/evil.example',
    '/a\\b',
    ['/'],
    `/${'a'.repeat(3000)}`,
  ])('neutralizes %j', (value) => {
    expect(sanitizeReturnTo(value)).toBe('/');
  });
});
