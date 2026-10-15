import { describe, expect, it } from 'vitest';
import { ApiError, errorCode, isApiErrorCode, parseApiError } from './api-error';

describe('parseApiError', () => {
  it.each([
    [401, 'AUTH_REQUIRED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [400, 'VALIDATION_FAILED'],
    [422, 'VALIDATION_FAILED'],
    [409, 'CONFLICT'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [429, 'RATE_LIMITED'],
    [502, 'UNAVAILABLE'],
    [503, 'UNAVAILABLE'],
    [504, 'UNAVAILABLE'],
    [500, 'INTERNAL'],
    [418, 'INTERNAL'],
  ])('derives code from status %i', (status, code) => {
    const error = parseApiError(status, undefined);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.fromEnvelope).toBe(false);
  });

  it('uses the envelope code and message', () => {
    const error = parseApiError(403, { error: { code: 'CSRF_FAILED', message: 'bad token' } });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe('ApiError');
    expect(error.code).toBe('CSRF_FAILED');
    expect(error.message).toBe('bad token');
    expect(error.fromEnvelope).toBe(true);
  });

  it('falls back to status when the body code is unknown', () => {
    const error = parseApiError(404, { error: { code: 'WHATEVER', message: 'x' } });
    expect(error.code).toBe('NOT_FOUND');
  });

  it('keeps well-formed details and drops malformed ones', () => {
    const error = parseApiError(400, {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'invalid',
        details: [{ path: 'a', issue: 'required' }, { path: 1 }, null, 'x'],
      },
    });
    expect(error.details).toEqual([{ path: 'a', issue: 'required' }]);
  });

  it('omits details when none are valid', () => {
    const error = parseApiError(400, {
      error: { code: 'VALIDATION_FAILED', message: 'm', details: 'nope' },
    });
    expect(error.details).toBeUndefined();
  });
});

describe('errorCode', () => {
  it('returns the ApiError code or INTERNAL', () => {
    expect(errorCode(parseApiError(409, undefined))).toBe('CONFLICT');
    expect(errorCode(new Error('x'))).toBe('INTERNAL');
    expect(errorCode(undefined)).toBe('INTERNAL');
  });
});

describe('isApiErrorCode', () => {
  it('accepts known codes only', () => {
    expect(isApiErrorCode('NETWORK')).toBe(true);
    expect(isApiErrorCode('INVALID_CATEGORY')).toBe(true);
    expect(isApiErrorCode('INVALID_ACCOUNT')).toBe(true);
    expect(isApiErrorCode('nope')).toBe(false);
    expect(isApiErrorCode(5)).toBe(false);
  });
});
