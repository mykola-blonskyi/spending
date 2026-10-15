import createClient from 'openapi-fetch';
import type { Middleware } from 'openapi-fetch';
import type { paths } from './api.gen';
import { ApiError, parseApiError } from './api-error';
import { emitAuthLost } from './auth-events';
import { clearCsrfToken, getCsrfToken, setCsrfToken } from './csrf';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function readBody(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.clone().text());
  } catch {
    return undefined;
  }
}

export const apiMiddleware: Middleware = {
  onRequest({ request }) {
    const token = getCsrfToken();
    if (!token || !UNSAFE_METHODS.has(request.method)) return undefined;
    request.headers.set('X-CSRF-Token', token);
    return request;
  },
  async onResponse({ response }) {
    if (response.ok) return undefined;
    const error = parseApiError(response.status, await readBody(response));
    // Only our own envelope proves the session ended; a bare 401 (e.g. from a proxy) must not log users out.
    if (
      response.status === 401 &&
      error.fromEnvelope &&
      (error.code === 'AUTH_REQUIRED' || error.code === 'SESSION_REVOKED')
    ) {
      clearCsrfToken();
      emitAuthLost(error.code);
    }
    throw error;
  },
  onError({ error }) {
    // Aborts must reach TanStack Query unchanged so it can treat them as cancellation.
    if (error instanceof DOMException && error.name === 'AbortError') return undefined;
    return new ApiError({
      status: 0,
      code: 'NETWORK',
      message: error instanceof Error ? error.message : 'Network request failed',
    });
  },
};

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: (input: Request) => Promise<Response>;
}

export function createApiClient(options: ApiClientOptions = {}) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? '',
    credentials: 'same-origin',
    ...(options.fetch && { fetch: options.fetch }),
  });
  client.use(
    {
      // A page started offline has no token yet; it is fetched before the first write.
      async onRequest({ request }) {
        if (getCsrfToken() || !UNSAFE_METHODS.has(request.method)) return undefined;
        const { data } = await client.GET('/api/v1/auth/session');
        if (data) setCsrfToken(data.csrfToken);
        return undefined;
      },
    },
    apiMiddleware,
  );
  return client;
}

export const api = createApiClient();
