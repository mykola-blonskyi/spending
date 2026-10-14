import { describe, expect, it } from 'vitest';
import { type CsrfInput, isCsrfSafe } from './csrf';

const valid: CsrfInput = {
  method: 'POST',
  appOrigin: 'https://spending.example',
  sessionCsrfToken: 'token-123',
  headerToken: 'token-123',
  origin: 'https://spending.example',
  secFetchSite: undefined,
};

describe('isCsrfSafe', () => {
  it('lets safe methods through untouched', () => {
    expect(isCsrfSafe({ ...valid, method: 'GET', headerToken: undefined, origin: 'x' })).toBe(true);
  });

  it('accepts a matching token from the app origin', () => {
    expect(isCsrfSafe(valid)).toBe(true);
    expect(isCsrfSafe({ ...valid, method: 'delete' })).toBe(true);
  });

  it.each<[string, Partial<CsrfInput>]>([
    ['missing header', { headerToken: undefined }],
    ['wrong token', { headerToken: 'token-124' }],
    ['shorter token', { headerToken: 'token' }],
    ['no session', { sessionCsrfToken: undefined }],
    ['foreign origin', { origin: 'https://evil.example' }],
    ['null origin', { origin: 'null' }],
    ['no origin and cross-site fetch', { origin: undefined, secFetchSite: 'cross-site' }],
    ['no origin and no fetch metadata', { origin: undefined }],
  ])('rejects %s', (_name, override) => {
    expect(isCsrfSafe({ ...valid, ...override })).toBe(false);
  });

  it('accepts a same-origin fetch that sent no Origin header', () => {
    expect(isCsrfSafe({ ...valid, origin: undefined, secFetchSite: 'same-origin' })).toBe(true);
  });
});
