import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home, List, Plus, Settings, Users } from 'lucide-react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppShell, type NavItem } from './index';

const navItems: NavItem[] = [
  { to: '/', label: 'Overview', icon: Home, placement: 'primary' },
  { to: '/transactions', label: 'Transactions', icon: List, placement: 'primary' },
  { to: '/family', label: 'Family', icon: Users, placement: 'secondary' },
  { to: '/settings', label: 'Settings', icon: Settings, placement: 'secondary' },
];

function renderShell(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell
        brand={<span>Spending</span>}
        navItems={navItems}
        primaryAction={{ to: '/transactions/new', label: 'Add transaction', icon: Plus }}
        status={<span>Up to date</span>}
      >
        <h1>Page</h1>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('renders labelled navigation landmarks with every destination in the sidebar', () => {
    renderShell();
    const [sidebar, tabBar] = screen.getAllByRole('navigation', { name: 'Main navigation' });
    for (const label of ['Overview', 'Transactions', 'Family', 'Settings']) {
      expect(within(sidebar!).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(within(tabBar!).getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(within(tabBar!).queryByRole('link', { name: 'Family' })).not.toBeInTheDocument();
    expect(within(tabBar!).getByRole('link', { name: 'Add transaction' })).toHaveAttribute(
      'href',
      '/transactions/new',
    );
  });

  it('marks only the current destination as the current page', () => {
    renderShell('/transactions');
    const current = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((link) => link.textContent === 'Transactions')).toBe(true);
  });

  it('offers a skip link to the main landmark', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('lists secondary destinations behind More on mobile', async () => {
    renderShell();
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    const sheet = await screen.findByRole('dialog', { name: 'All sections' });
    expect(within(sheet).getByRole('link', { name: 'Family' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });
});
