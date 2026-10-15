import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home, List, PiggyBank, Plus, Settings, Users } from 'lucide-react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@shared/ui/tooltip';
import {
  BentoShell,
  CalmShell,
  CardsShell,
  JournalShell,
  type NavItem,
  PlayfulShell,
  type ShellProps,
  SoftShell,
  SplitShell,
} from './index';

const navItems: NavItem[] = [
  { to: '/', label: 'Overview', icon: Home, placement: 'primary' },
  { to: '/transactions', label: 'Transactions', icon: List, placement: 'primary' },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank, placement: 'primary' },
  { to: '/family', label: 'Family', icon: Users, placement: 'secondary' },
  { to: '/settings', label: 'Settings', icon: Settings, placement: 'secondary' },
];

const shells: [string, React.ComponentType<ShellProps>][] = [
  ['calm', CalmShell],
  ['cards', CardsShell],
  ['soft', SoftShell],
  ['journal', JournalShell],
  ['bento', BentoShell],
  ['split', SplitShell],
  ['playful', PlayfulShell],
];

function renderShell(Shell: React.ComponentType<ShellProps>, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <Shell
          brand={<span>Spending</span>}
          navItems={navItems}
          primaryAction={{ to: '/transactions/new', label: 'Add transaction', icon: Plus }}
          status={<span>Up to date</span>}
        >
          <h1>Page</h1>
        </Shell>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe.each(shells)('%s shell', (_name, Shell) => {
  it('offers every destination and the add action from labelled navigation', async () => {
    renderShell(Shell);
    const navs = screen.getAllByRole('navigation', { name: 'Main navigation' });
    expect(navs.length).toBeGreaterThan(0);
    for (const label of ['Overview', 'Transactions', 'Budgets']) {
      expect(screen.getAllByRole('link', { name: label }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('link', { name: 'Add transaction' })[0]).toHaveAttribute(
      'href',
      '/transactions/new',
    );
    // Secondary destinations are either listed outright or behind "More" (a sheet or a menu).
    if (screen.queryAllByRole('link', { name: 'Family' }).length === 0) {
      await userEvent.click(screen.getAllByRole('button', { name: 'More' })[0]!);
      for (const name of ['Family', 'Settings']) {
        await waitFor(() =>
          expect(
            screen.queryByRole('menuitem', { name }) ?? screen.getByRole('link', { name }),
          ).toBeInTheDocument(),
        );
      }
    }
  });

  it('marks only the current destination as the current page', () => {
    renderShell(Shell, '/transactions');
    const current = screen.getAllByRole('link', { current: 'page' });
    expect(current.length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { current: 'page', name: 'Transactions' })).toHaveLength(
      current.length,
    );
  });

  it('gives every link real classes, not a stringified className function', () => {
    renderShell(Shell);
    for (const link of screen.getAllByRole('link')) expect(link.className).not.toMatch(/=>/);
  });

  it('offers a skip link to the main landmark', () => {
    renderShell(Shell);
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });
});
