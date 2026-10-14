import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@data/api-error';
import { hasPendingChanges } from '@data/local-data';
import { createQueryClient } from '@data/query-client';
import { logout } from '@data/session';
import { testSession } from '@data/testing';
import { I18nProvider } from '@i18n/index';
import { loadPage } from '@shared/lib/navigation';
import { SessionContext } from './session-context';
import { useSignOut } from './sign-out';

vi.mock('@shared/lib/navigation', () => ({ loadPage: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock(import('@data/session'), async (importOriginal) => ({
  ...(await importOriginal()),
  logout: vi.fn(),
}));
vi.mock(import('@data/local-data'), async (importOriginal) => ({
  ...(await importOriginal()),
  hasPendingChanges: vi.fn(),
}));

function SignOutButton() {
  const signOut = useSignOut();
  return (
    <>
      <button disabled={signOut.busy} onClick={signOut.request}>
        Sign out
      </button>
      {signOut.dialog}
    </>
  );
}

function renderButton() {
  const client = createQueryClient();
  client.setQueryData(['me'], testSession().user);
  localStorage.setItem(`spending.user.${testSession().user.id}.queue`, '[]');
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <SessionContext value={testSession()}>
          <SignOutButton />
        </SessionContext>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(hasPendingChanges).mockResolvedValue(false);
});

describe('useSignOut', () => {
  it('ends the session, clears local data and leaves through the provider', async () => {
    vi.mocked(logout).mockResolvedValue({ endSessionUrl: 'https://login.example/logout' });
    const client = renderButton();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('https://login.example/logout'));
    expect(client.getQueryCache().getAll()).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it('falls back to the sign-in page without an end-session URL', async () => {
    vi.mocked(logout).mockResolvedValue({ endSessionUrl: null });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/signin'));
  });

  it('treats an already ended session as signed out', async () => {
    vi.mocked(logout).mockRejectedValue(
      new ApiError({ status: 401, code: 'SESSION_REVOKED', message: 'x', fromEnvelope: true }),
    );
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/signin'));
    expect(localStorage.length).toBe(0);
  });

  it('stays signed in and explains a failure', async () => {
    vi.mocked(logout).mockRejectedValue(new ApiError({ status: 0, code: 'NETWORK', message: 'x' }));
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'No connection to the server. Check your internet and try again.',
      ),
    );
    expect(loadPage).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(1);
  });

  it('asks first when local changes would be lost', async () => {
    vi.mocked(hasPendingChanges).mockResolvedValue(true);
    vi.mocked(logout).mockResolvedValue({ endSessionUrl: null });
    renderButton();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Sign out with unsynced changes?',
    );
    expect(logout).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out anyway' }));
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/signin'));
  });
});
