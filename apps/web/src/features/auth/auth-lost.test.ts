import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitAuthLost } from '@data/auth-events';
import { createQueryClient } from '@data/query-client';
import { sessionQuery } from '@data/session';
import { testSession } from '@data/testing';
import { installAuthLostHandler } from './auth-lost';

describe('installAuthLostHandler', () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    window.history.replaceState(null, '', '/budgets?month=2026-10');
  });

  afterEach(() => {
    uninstall();
    localStorage.clear();
  });

  it('clears server state and goes to sign-in, keeping the location', () => {
    const client = createQueryClient();
    client.setQueryData(sessionQuery.queryKey, testSession());
    client.setQueryData(['accounts'], ['cash']);
    const navigate = vi.fn();
    uninstall = installAuthLostHandler(client, navigate);

    emitAuthLost('SESSION_REVOKED');

    expect(navigate).toHaveBeenCalledWith(
      '/signin?returnTo=%2Fbudgets%3Fmonth%3D2026-10&reason=SESSION_REVOKED',
    );
    expect(client.getQueryData(['accounts'])).toBeUndefined();
    expect(client.getQueryData(sessionQuery.queryKey)).toBeNull();
  });

  it('leaves a 401 before any session was known to the route guards', () => {
    const client = createQueryClient();
    client.setQueryData(['accounts'], ['cash']);
    const navigate = vi.fn();
    uninstall = installAuthLostHandler(client, navigate);

    emitAuthLost('AUTH_REQUIRED');

    expect(navigate).not.toHaveBeenCalled();
    expect(client.getQueryData(['accounts'])).toEqual(['cash']);
  });

  it('stops listening once uninstalled', () => {
    const client = createQueryClient();
    client.setQueryData(sessionQuery.queryKey, testSession());
    const navigate = vi.fn();
    installAuthLostHandler(client, navigate)();

    emitAuthLost('AUTH_REQUIRED');

    expect(navigate).not.toHaveBeenCalled();
  });
});
