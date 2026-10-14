import { describe, expect, it } from 'vitest';
import { loginHref, safeReturnTo, signInPath } from './return-to';

describe('safeReturnTo', () => {
  it.each([
    ['/budgets?month=2026-10#top', '/budgets?month=2026-10#top'],
    ['/', '/'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example/', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['budgets', '/'],
    ['/signin', '/'],
    ['/signin?returnTo=%2Fbudgets', '/'],
  ])('%s becomes %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});

describe('signInPath', () => {
  it('carries the return target and reason', () => {
    expect(signInPath('/budgets?month=2026-10', 'SESSION_REVOKED')).toBe(
      '/signin?returnTo=%2Fbudgets%3Fmonth%3D2026-10&reason=SESSION_REVOKED',
    );
  });

  it('omits the default target', () => {
    expect(signInPath('/')).toBe('/signin');
    expect(signInPath('//evil.example')).toBe('/signin');
  });
});

describe('loginHref', () => {
  it('passes the return target to the API', () => {
    expect(loginHref('/budgets?month=2026-10')).toBe(
      '/api/v1/auth/login?returnTo=%2Fbudgets%3Fmonth%3D2026-10',
    );
  });
});
