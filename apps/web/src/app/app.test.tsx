import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { invitationPreviewQuery, workspacesQuery } from '@data/family';
import { createQueryClient } from '@data/query-client';
import { type Profile, type ProfilePatch, type Session, sessionQuery } from '@data/session';
import { testProfile, testSession } from '@data/testing';
import { useLocaleStore } from '@i18n/index';
import { AppProviders } from './providers';
import { routes } from './routes';

vi.mock(import('@data/session'), async (importOriginal) => ({
  ...(await importOriginal()),
  updateMe: async (patch: ProfilePatch): Promise<Profile> => ({ ...testProfile, ...patch }),
}));

function renderAt(
  path: string,
  session: Session | null = testSession(),
  seed: (queryClient: ReturnType<typeof createQueryClient>) => void = () => {},
) {
  const queryClient = createQueryClient();
  queryClient.setQueryData(sessionQuery.queryKey, session);
  seed(queryClient);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('app routes', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    useLocaleStore.getState().setLocale('en');
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows the login failure message on the sign-in page', () => {
    renderAt('/signin?error=login_failed', null);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome to Spending');
    expect(screen.getByText('Sign-in did not complete. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/login?returnTo=%2F',
    );
  });

  it('ignores unknown error codes and refuses off-site return targets', () => {
    renderAt('/signin?error=boom&returnTo=//evil.example', null);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/login?returnTo=%2F',
    );
  });

  it('renders the translated shell and page in the profile language', () => {
    renderAt('/budgets', testSession({ locale: 'uk' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Бюджети');
    const [sidebar] = screen.getAllByRole('navigation', { name: 'Основна навігація' });
    expect(within(sidebar!).getByRole('link', { name: 'Бюджети' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('switches the theme from settings', async () => {
    renderAt('/settings');
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    await userEvent.click(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
  });

  it('switches the palette and the layout from settings', async () => {
    renderAt('/settings');
    expect(document.documentElement.dataset.palette).toBe('emerald');
    await userEvent.click(screen.getByRole('radio', { name: 'Rose' }));
    await waitFor(() => expect(document.documentElement.dataset.palette).toBe('rose'));
    expect(localStorage.getItem('spending.palette')).toBe('rose');

    expect(document.querySelector('[data-layout]')).toHaveAttribute('data-layout', 'calm');
    await userEvent.click(screen.getByRole('radio', { name: 'Bento' }));
    await waitFor(() =>
      expect(document.querySelector('[data-layout]')).toHaveAttribute('data-layout', 'bento'),
    );
    expect(screen.getByRole('radio', { name: 'Bento' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows a not-found page inside the shell', () => {
    renderAt('/nowhere');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
  });

  it('sets the document title and moves focus to main on navigation, not on first load', async () => {
    renderAt('/');
    expect(document.title).toBe('Overview · Spending');
    expect(document.getElementById('main')).not.toHaveFocus();

    const [sidebar] = screen.getAllByRole('navigation', { name: 'Main navigation' });
    await userEvent.click(within(sidebar!).getByRole('link', { name: 'Budgets' }));
    expect(document.title).toBe('Budgets · Spending');
    expect(document.getElementById('main')).toHaveFocus();
  });

  it('retitles the document when the language changes', () => {
    renderAt('/budgets');
    expect(document.title).toBe('Budgets · Spending');
    act(() => useLocaleStore.getState().setLocale('uk'));
    expect(document.title).toBe('Бюджети · Spending');
  });

  it('retitles and focuses pages outside the shell too', async () => {
    const router = renderAt('/settings', testSession(), (queryClient) => {
      queryClient.setQueryData(workspacesQuery.queryKey, [
        { id: 'ws-1', kind: 'personal', name: 'Ann', role: 'owner', members: [] },
      ]);
      queryClient.setQueryData(invitationPreviewQuery('abc').queryKey, {
        familyName: 'Home',
        ownerName: 'Bob',
        expiresAt: '2026-10-22T00:00:00.000Z',
        state: 'pending',
      });
    });
    expect(document.title).toBe('Settings · Spending');
    await act(() => router.navigate('/invite/abc'));
    expect(document.title).toBe('Join Home? · Spending');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('returns from sign-in to the invitation link held in this tab, then forgets it', async () => {
    sessionStorage.setItem('spending.pendingInvite', 'abc');
    const router = renderAt('/invite', testSession(), (queryClient) => {
      queryClient.setQueryData(workspacesQuery.queryKey, [
        { id: 'ws-1', kind: 'personal', name: 'Ann', role: 'owner', members: [] },
      ]);
      queryClient.setQueryData(invitationPreviewQuery('abc').queryKey, {
        familyName: 'Home',
        ownerName: 'Bob',
        expiresAt: '2026-10-22T00:00:00.000Z',
        state: 'pending',
      });
    });
    expect(await screen.findByRole('button', { name: 'Join Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/invite/abc');
    expect(sessionStorage.getItem('spending.pendingInvite')).toBeNull();
  });

  it.each([
    ['nothing is held', () => {}],
    [
      'storage is unavailable',
      () => {
        const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
          throw new DOMException('blocked', 'SecurityError');
        });
        onTestFinished(() => blocked.mockRestore());
      },
    ],
  ])('asks to open the invitation link again when %s', async (_, arrange) => {
    arrange();
    const router = renderAt('/invite', testSession());
    expect(
      await screen.findByRole('heading', { name: 'Open your invitation link again' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/invite');
  });

  it('sends a signed-out visitor to sign-in, keeping the deep link', () => {
    const router = renderAt('/budgets?month=2026-10', null);
    expect(router.state.location.pathname).toBe('/signin');
    expect(router.state.location.search).toBe('?returnTo=%2Fbudgets%3Fmonth%3D2026-10');
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/login?returnTo=%2Fbudgets%3Fmonth%3D2026-10',
    );
  });

  it('sends someone already signed in from sign-in to their return target', () => {
    const router = renderAt('/signin?returnTo=%2Fbudgets');
    expect(router.state.location.pathname).toBe('/budgets');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Budgets');
  });

  it('shows who is signed in', () => {
    renderAt('/');
    expect(screen.getByRole('button', { name: 'Account: Ann Example' })).toHaveTextContent(
      'Ann Example',
    );
  });

  it('explains why the session ended', () => {
    renderAt('/signin?reason=SESSION_REVOKED', null);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'You were signed out. Please sign in again.',
    );
  });
});
