import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@data/query-client';
import { useLocaleStore } from '@i18n/index';
import { AppProviders } from './providers';
import { routes } from './routes';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders queryClient={createQueryClient()}>
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
  });

  it('shows the login failure message on the sign-in page', () => {
    renderAt('/signin?error=login_failed');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome to Spending');
    expect(screen.getByText('Sign-in did not complete. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/login?returnTo=%2F',
    );
  });

  it('ignores unknown error codes and refuses off-site return targets', () => {
    renderAt('/signin?error=boom&returnTo=//evil.example');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/login?returnTo=%2F',
    );
  });

  it('renders the translated shell and page in the active language', () => {
    useLocaleStore.getState().setLocale('uk');
    renderAt('/budgets');
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
    expect(document.documentElement).toHaveClass('dark');
    await userEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement).not.toHaveClass('dark');
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
    const router = renderAt('/settings');
    expect(document.title).toBe('Settings · Spending');
    await act(() => router.navigate('/signin'));
    expect(document.title).toBe('Welcome to Spending · Spending');
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
