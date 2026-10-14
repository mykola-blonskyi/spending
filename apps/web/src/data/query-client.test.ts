import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error';
import { createQueryClient, shouldRetry } from './query-client';

const apiError = (status: number) =>
  new ApiError({ status, code: status === 0 ? 'NETWORK' : 'INTERNAL', message: 'x' });

describe('shouldRetry', () => {
  it('never retries 4xx', () => {
    expect(shouldRetry(0, apiError(400))).toBe(false);
    expect(shouldRetry(0, apiError(429))).toBe(false);
  });

  it.each([apiError(500), apiError(0), new Error('boom')])('retries twice for %s', (error) => {
    expect(shouldRetry(0, error)).toBe(true);
    expect(shouldRetry(1, error)).toBe(true);
    expect(shouldRetry(2, error)).toBe(false);
  });
});

describe('createQueryClient', () => {
  it('applies defaults', () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.retry).toBe(shouldRetry);
    expect(defaults.mutations?.retry).toBe(false);
  });
});
