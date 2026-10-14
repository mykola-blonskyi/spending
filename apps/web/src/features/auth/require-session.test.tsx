import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@data/api-error';
import { api } from '@data/client';
import { getCsrfToken } from '@data/csrf';
import { createQueryClient } from '@data/query-client';
import { testSession } from '@data/testing';
import { I18nProvider } from '@i18n/index';
import { RedirectIfSignedIn, RequireSession } from './require-session';
import { useSession } from './session-context';

vi.mock('@data/client', () => ({ api: { GET: vi.fn() } }));
const get = vi.mocked(api.GET);

function Protected() {
  return <h1>Hello {useSession().user.displayName}</h1>;
}

function renderAt(path: string, client = createQueryClient()) {
  const router = createMemoryRouter(
    [
      {
        path: '/signin',
        element: (
          <RedirectIfSignedIn>
            <h1>Sign in</h1>
          </RedirectIfSignedIn>
        ),
      },
      {
        path: '*',
        element: (
          <RequireSession>
            <Protected />
          </RequireSession>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return router;
}

const signedOut = () =>
  Promise.reject(
    new ApiError({ status: 401, code: 'AUTH_REQUIRED', message: 'x', fromEnvelope: true }),
  );

beforeEach(() => {
  get.mockReset();
});

describe('RequireSession', () => {
  it('shows a loading skeleton while the session is checked', () => {
    get.mockReturnValue(new Promise(() => {}));
    renderAt('/budgets');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(get).toHaveBeenCalledWith('/api/v1/auth/session', expect.anything());
  });

  it('renders the page with the session and keeps the CSRF token', async () => {
    get.mockResolvedValue({ data: testSession() } as never);
    renderAt('/budgets');
    expect(await screen.findByRole('heading', { name: 'Hello Ann Example' })).toBeInTheDocument();
    expect(getCsrfToken()).toBe('csrf-test');
  });

  it('sends a signed-out visitor to sign-in with the full return target', async () => {
    get.mockImplementation(signedOut);
    const router = renderAt('/budgets?month=2026-10');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?returnTo=%2Fbudgets%3Fmonth%3D2026-10');
  });

  it('shows a translated error with retry when the check fails', async () => {
    get.mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK', message: 'x' }));
    get.mockResolvedValueOnce({ data: testSession() } as never);
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    renderAt('/', client);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No connection to the server. Check your internet and try again.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Hello Ann Example' })).toBeInTheDocument();
  });
});

describe('RedirectIfSignedIn', () => {
  it('shows the sign-in page when signed out', async () => {
    get.mockImplementation(signedOut);
    renderAt('/signin?returnTo=%2Fbudgets');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('sends someone signed in to the return target', async () => {
    get.mockResolvedValue({ data: testSession() } as never);
    const router = renderAt('/signin?returnTo=%2Fbudgets');
    expect(await screen.findByRole('heading', { name: 'Hello Ann Example' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/budgets');
  });
});
