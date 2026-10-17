import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportResult } from '@data/imports';
import {
  type Account,
  type Category,
  type TransactionEntry,
  useLocalTransactions,
  useMarkTransfer,
  useSyncStatus,
  useWorkspaces,
  type Workspace,
} from '@data/sync';
import { I18nProvider } from '@i18n/index';
import { ImportSummary } from './import-summary';
import { TransferSuggestions } from './transfer-suggestions';
import { useHasFamily, useReviewQueue } from './imports';
import { bulkCategoryChoice } from './review-choice';
import { ReviewPage } from './review-page';

vi.mock('@shared/lib/network', () => ({ useOnlineStatus: () => true }));
vi.mock(import('@data/sync'), async (importOriginal) => ({
  ...(await importOriginal()),
  useWorkspaces: vi.fn(),
  useCategories: vi.fn(() => ({ ready: true, items: [] })),
  useLocalTransactions: vi.fn(),
  useSyncStatus: vi.fn(() => null),
  useUpdateTransaction: vi.fn(),
  useAccounts: vi.fn(() => ({
    ready: true,
    items: [{ id: 'savings', name: 'Savings' } as Account],
  })),
  useMarkTransfer: vi.fn(),
}));
vi.mock('./imports', () => ({
  useHasFamily: vi.fn(),
  useReviewQueue: vi.fn(),
  useConfirmReview: () => ({ mutate: vi.fn(), isPending: false }),
}));

const personal = { id: 'w1', kind: 'personal', name: 'Mine' } as Workspace;
const category = (id: string, kind: Category['kind']) =>
  ({ id, kind, workspaceId: 'w2' }) as Category;

const ui = (node: React.ReactNode) =>
  render(
    <MemoryRouter>
      <I18nProvider locale="en">{node}</I18nProvider>
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

describe('ReviewPage', () => {
  it('tells a user without a family there is nothing to review instead of loading forever', () => {
    vi.mocked(useWorkspaces).mockReturnValue({ ready: true, items: [personal] });
    vi.mocked(useHasFamily).mockReturnValue(false);
    vi.mocked(useReviewQueue).mockReturnValue({
      isPending: true,
      isSuccess: false,
      isError: false,
      data: undefined,
    } as unknown as ReturnType<typeof useReviewQueue>);
    ui(<ReviewPage />);
    expect(screen.getByRole('heading', { name: 'Nothing to review' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('bulkCategoryChoice', () => {
  it('leaves a row outside the bulk scope, or of another kind, as it was', () => {
    const groceries = category('c1', 'expense');
    const kept = { scope: 'personal', categoryId: 'c0' } as const;
    expect(bulkCategoryChoice(kept, 'expense', 'family', groceries)).toBe(kept);
    expect(
      bulkCategoryChoice({ scope: 'family', categoryId: null }, 'income', 'family', groceries),
    ).toEqual({ scope: 'family', categoryId: null });
    expect(
      bulkCategoryChoice({ scope: 'family', categoryId: null }, 'expense', 'family', groceries),
    ).toEqual({ scope: 'family', categoryId: 'c1' });
  });
});

describe('ImportSummary', () => {
  const result = {
    batch: { fileName: 'bank.csv' },
    imported: { count: 2, transactionIds: ['t1', 't2'], transferSuggestions: [] },
    duplicates: 0,
    rejected: [],
  } as unknown as ImportResult;
  const summary = () =>
    ui(
      <ImportSummary
        result={result}
        accountName="Main"
        waitsForReview={false}
        onImportAnother={() => {}}
      />,
    );

  it('shows a loading state until every imported entry has reached this device', () => {
    vi.mocked(useLocalTransactions).mockReturnValue({
      ready: true,
      items: [{ id: 't1', workspaceId: 'w1' } as TransactionEntry],
    });
    summary();
    expect(screen.getByRole('status', { busy: true })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Imported entries' })).not.toBeInTheDocument();
  });

  it('says why the entries are not coming when the device cannot sync', () => {
    vi.mocked(useLocalTransactions).mockReturnValue({ ready: true, items: [] });
    vi.mocked(useSyncStatus).mockReturnValue({ state: 'offline', count: 0 });
    summary();
    expect(
      screen.getByText('The imported entries appear here once this device can sync again.'),
    ).toBeInTheDocument();
  });

  it('moves focus to the result heading', () => {
    vi.mocked(useLocalTransactions).mockReturnValue({ ready: true, items: [] });
    summary();
    expect(screen.getByRole('heading', { name: 'Import finished' })).toHaveFocus();
  });
});

describe('TransferSuggestions', () => {
  const entry = (id: string, extra: Partial<TransactionEntry> = {}) =>
    ({
      id,
      workspaceId: 'w1',
      kind: 'expense',
      amountMinor: 50_000,
      currency: 'EUR',
      occurredOn: '2026-10-10',
      accountId: 'card',
      description: id,
      transferId: null,
      ...extra,
    }) as TransactionEntry;
  const suggestions = [
    { transactionId: 'out', counterpartId: 'in', reason: 'counterpart' },
    { transactionId: 'own', counterpartId: null, reason: 'keyword' },
    { transactionId: 'marked', counterpartId: null, reason: 'keyword' },
    { transactionId: 'gone', counterpartId: 'taken', reason: 'counterpart' },
  ] as const;

  it('offers each open suggestion, confirms it as a transfer and dismisses it', async () => {
    const mark = vi.fn(async () => {});
    vi.mocked(useMarkTransfer).mockReturnValue(mark);
    vi.mocked(useLocalTransactions).mockReturnValue({
      ready: true,
      items: [
        entry('out'),
        entry('in', { kind: 'income', accountId: 'savings', occurredOn: '2026-10-11' }),
        entry('own'),
        entry('marked', { transferId: 'x' }),
        entry('gone'),
        entry('taken', { kind: 'income', accountId: 'savings', transferId: 'y' }),
      ],
    });
    ui(<TransferSuggestions suggestions={suggestions} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Suggested transfer: out',
      'Suggested transfer: own',
    ]);
    expect(items[0]).toHaveTextContent('Other side: Savings, Oct 11, 2026');
    expect(items[1]).toHaveTextContent('Own account outside the app');

    fireEvent.click(within(items[0]!).getByRole('button', { name: 'Confirm' }));
    expect(mark).toHaveBeenCalledWith('out', 'in');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm all' }));
    await vi.waitFor(() => expect(mark).toHaveBeenLastCalledWith('own', null));

    fireEvent.click(within(items[1]!).getByRole('button', { name: 'Dismiss' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Confirm all' })).not.toBeInTheDocument();
  });
});
