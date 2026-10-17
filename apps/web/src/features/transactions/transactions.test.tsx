import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalState, ServerTransaction } from '@data/sync/model';
import {
  fakeLocalData,
  FAMILY,
  localRow,
  PERSONAL,
  sequentialIds,
  serverRow,
  syncedState,
} from '@data/sync/fixtures';
import { reducePush } from '@data/sync/push';
import { applyLocalChange } from '@data/sync/queue';
import { testProfile, testSession } from '@data/testing';
import { CalmEntry } from './layouts/calm-entry';
import { TRANSACTION_SCREENS } from './layouts/screens';
import { account, category, renderTransactionScreen } from './test-helpers';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const bob = { userId: '00000000-0000-4000-8000-000000000002', displayName: 'Bob' };

function setup(path: string, ...rows: ServerTransaction[]) {
  const state = {
    ...syncedState(...rows),
    workspaces: new Map([PERSONAL, FAMILY].map((w) => [w.id, w])),
    accounts: new Map(
      [
        account({ id: 'acc-joint', workspaceId: FAMILY.id, name: 'Joint' }),
        account({ id: 'acc-ann', workspaceId: PERSONAL.id, name: 'Ann wallet' }),
      ].map((a) => [a.id, a]),
    ),
    categories: new Map(
      [
        category({ id: 'cat-home', workspaceId: FAMILY.id, name: 'Household', systemKey: null }),
        category({ id: 'cat-mine', workspaceId: PERSONAL.id, name: 'Mine', systemKey: null }),
      ].map((c) => [c.id, c]),
    ),
  };
  const route = path === '/transactions/new' ? path : '/transactions/:id';
  return renderTransactionScreen(<CalmEntry />, { data: fakeLocalData(state).value, path, route });
}

async function openOptions(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name }));
  return within(await screen.findByRole('listbox'))
    .getAllByRole('option')
    .map((o) => o.textContent);
}

beforeAll(() => {
  // Radix Select opens on pointer events jsdom does not implement.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

describe.each(Object.entries(TRANSACTION_SCREENS))('the %s entry screen', (_, { entry: Entry }) => {
  const ledger = {
    ...syncedState(serverRow({ accountId: 'acc-card' })),
    accounts: new Map([['acc-card', account()]]),
    categories: new Map([['cat-groceries', category()]]),
  };
  const open = (state: LocalState, path: string) =>
    renderTransactionScreen(<Entry />, {
      data: fakeLocalData(state).value,
      path,
      route: path === '/transactions/new' ? path : '/transactions/:id',
    });

  it('asks for the kind before the category', () => {
    open(ledger, '/transactions/new');
    const kind = screen.getByRole('radio', { name: 'Expense' });
    const categories = screen.getByRole('radiogroup', { name: 'Category' });
    expect(kind.compareDocumentPosition(categories)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('moves focus to the invalid amount when a save is refused', async () => {
    open(ledger, '/transactions/new');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(screen.getByLabelText('Amount')).toHaveFocus();
  });

  it('says why the server rejected a change', () => {
    const edited = applyLocalChange(
      ledger,
      { type: 'upsert', row: localRow({ accountId: 'acc-card', categoryId: 'cat-archived' }) },
      sequentialIds(),
    );
    const rejected = reducePush(
      edited,
      [{ mutationId: 'm-1', status: 'rejected', code: 'INVALID_CATEGORY', message: 'archived' }],
      '2026-10-15T00:00:00.000Z',
      ['m-1'],
    );
    open(rejected, '/transactions/tx-1');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This category is archived or does not fit this type. Pick another one.',
    );
  });
});

describe('editing a family entry', () => {
  const familyEntry = (author: ServerTransaction['author']) =>
    serverRow({ workspaceId: FAMILY.id, scope: 'family', author });

  it("offers another member's family entry only the family accounts (BR-3)", async () => {
    setup('/transactions/tx-1', familyEntry(bob));
    expect(screen.queryByRole('radiogroup', { name: 'Who is this for' })).not.toBeInTheDocument();
    expect(await openOptions('Account')).toEqual(['No account', 'Joint']);
  });

  it("offers the author's own personal accounts too", async () => {
    const ann = { userId: testProfile.id, displayName: testProfile.displayName };
    setup('/transactions/tx-1', familyEntry(ann));
    expect(await openOptions('Account')).toEqual(['No account', 'Ann wallet', 'Joint']);
  });
});

describe('recording a new entry', () => {
  it('keeps what was typed across a scope change and drops only the category', async () => {
    setup('/transactions/new');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '12.50' } });
    await userEvent.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(screen.getByRole('radio', { name: 'Mine' })).toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: 'Family' }));
    expect(screen.getByLabelText('Amount')).toHaveValue('12.50');
    const picker = screen.getByRole('radiogroup', { name: 'Category' });
    expect(
      within(picker)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Household']);
    expect(within(picker).getByRole('radio', { name: 'Household' })).not.toBeChecked();
    expect(await openOptions('Account')).toEqual(['No account', 'Ann wallet', 'Joint']);
  });
});
