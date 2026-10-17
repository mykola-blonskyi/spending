import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-error';

const MAX_RETRIES = 2;

/**
 * TanStack assumes online until an `offline` event, which a cold start offline never fires, so
 * without the `onLine` check the offline state would wait out every retry.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (!navigator.onLine) return false;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}
