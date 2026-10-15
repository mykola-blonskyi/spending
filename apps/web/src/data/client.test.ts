import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-error';
import { onAuthLost } from './auth-events';
import { createApiClient } from './client';
import { clearCsrfToken, getCsrfToken, setCsrfToken } from './csrf';

type Loose = Record<'GET' | 'POST' | 'DELETE', (path: string) => Promise<unknown>>;

function setup(respond: () => Response | Promise<Response>) {
  const fetchMock = vi.fn((_request: Request) => Promise.resolve(respond()));
  const client = createApiClient({ baseUrl: 'http://localhost', fetch: fetchMock });
  return { fetchMock, client, loose: client as unknown as Loose };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const sentRequest = (fetchMock: ReturnType<typeof setup>['fetchMock']) =>
  fetchMock.mock.calls[0]![0];

afterEach(() => {
  clearCsrfToken();
});

describe('CSRF header', () => {
  it.each(['POST', 'DELETE'] as const)('is added on %s when a token is set', async (method) => {
    setCsrfToken('tok');
    const { fetchMock, loose } = setup(() => json(200, {}));
    await loose[method]('/api/x');
    expect(sentRequest(fetchMock).headers.get('X-CSRF-Token')).toBe('tok');
  });

  it('is not added on GET', async () => {
    setCsrfToken('tok');
    const { fetchMock, client } = setup(() => json(200, { status: 'ok' }));
    await client.GET('/api/health');
    expect(sentRequest(fetchMock).headers.has('X-CSRF-Token')).toBe(false);
  });

  it('is fetched before the first write when the page has none, as after starting offline', async () => {
    const { fetchMock, loose, client } = setup(() => json(200, { csrfToken: 'fresh' }));
    await client.GET('/api/health');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await loose.POST('/api/x');
    const [, session, write] = fetchMock.mock.calls.map(([request]) => request);
    expect(new URL(session!.url).pathname).toBe('/api/v1/auth/session');
    expect(write!.headers.get('X-CSRF-Token')).toBe('fresh');
    expect(getCsrfToken()).toBe('fresh');
  });
});

describe('error handling', () => {
  it('throws on SESSION_REVOKED, emits auth lost once and clears the token', async () => {
    setCsrfToken('tok');
    const listener = vi.fn();
    const unsubscribe = onAuthLost(listener);
    const { client } = setup(() =>
      json(401, { error: { code: 'SESSION_REVOKED', message: 'revoked' } }),
    );

    const error = await client.GET('/api/health').catch((e: unknown) => e);
    unsubscribe();

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('SESSION_REVOKED');
    expect(listener).toHaveBeenCalledExactlyOnceWith('SESSION_REVOKED');
    expect(getCsrfToken()).toBeUndefined();
  });

  it('does not emit auth lost for a 401 without our error envelope', async () => {
    setCsrfToken('tok');
    const listener = vi.fn();
    const unsubscribe = onAuthLost(listener);
    const { client } = setup(() => new Response('<html>proxy login</html>', { status: 401 }));

    const error = (await client.GET('/api/health').catch((e: unknown) => e)) as ApiError;
    unsubscribe();

    expect(error.code).toBe('AUTH_REQUIRED');
    expect(error.fromEnvelope).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(getCsrfToken()).toBe('tok');
  });

  it('stops notifying after unsubscribe', async () => {
    const listener = vi.fn();
    onAuthLost(listener)();
    const { client } = setup(() => json(401, { error: { code: 'AUTH_REQUIRED', message: 'x' } }));
    await client.GET('/api/health').catch(() => undefined);
    expect(listener).not.toHaveBeenCalled();
  });

  it('maps a 500 without a JSON body to INTERNAL', async () => {
    const { client } = setup(() => new Response('<html>oops</html>', { status: 500 }));
    const error = await client.GET('/api/health').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('INTERNAL');
    expect((error as ApiError).status).toBe(500);
  });

  it('parses the envelope with details', async () => {
    const { client } = setup(() =>
      json(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'invalid',
          details: [{ path: 'name', issue: 'required' }],
        },
      }),
    );
    const error = (await client.GET('/api/health').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe('invalid');
    expect(error.details).toEqual([{ path: 'name', issue: 'required' }]);
  });

  it('wraps fetch rejections as NETWORK with status 0', async () => {
    const { client } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    const error = (await client.GET('/api/health').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('NETWORK');
    expect(error.status).toBe(0);
  });

  it('lets AbortError propagate unchanged', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const { client } = setup(() => {
      throw abort;
    });
    const error = await client.GET('/api/health').catch((e: unknown) => e);
    expect(error).toBe(abort);
  });
});
