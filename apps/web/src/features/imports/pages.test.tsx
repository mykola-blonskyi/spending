import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportResult, ReviewItem } from '@data/imports';
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
import { ApiError } from '@data/api-error';
import { I18nProvider } from '@i18n/index';
import { ImportSummary } from './import-summary';
import { TransferSuggestions } from './transfer-suggestions';
import { useHasFamily, useImportBatches, useReviewQueue } from './imports';
import { ImportsPage } from './imports-page';
import { bulkCategoryChoice, transferChoice } from './review-choice';
import { ReviewPage } from './review-page';

vi.mock('@shared/lib/network', () => ({ useOnlineStatus: () => online.value }));
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
const confirmMutate = vi.hoisted(() => vi.fn());
const removeMutate = vi.hoisted(() => vi.fn());
const clearMutate = vi.hoisted(() => vi.fn());
const online = vi.hoisted(() => ({ value: true }));
vi.mock('./imports', () => ({
  useHasFamily: vi.fn(),
  useReviewQueue: vi.fn(),
  useImportBatches: vi.fn(),
  useUndoImport: vi.fn(),
  useRemoveImport: () => ({ mutate: removeMutate }),
  useClearUndoneImports: () => ({ mutate: clearMutate }),
  useConfirmReview: () => ({ mutate: confirmMutate, isPending: false }),
  bankCategoryOf: () => undefined,
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

beforeEach(() => {
  vi.clearAllMocks();
  online.value = true;
});

describe('ImportsPage', () => {
  it('shows past imports as needing a connection when they cannot be loaded offline', () => {
    vi.mocked(useHasFamily).mockReturnValue(false);
    vi.mocked(useReviewQueue).mockReturnValue({ data: [] } as unknown as ReturnType<
      typeof useReviewQueue
    >);
    vi.mocked(useImportBatches).mockReturnValue({
      isPending: false,
      isError: true,
      isSuccess: false,
      fetchStatus: 'idle',
      error: new ApiError({ status: 0, code: 'NETWORK', message: 'offline' }),
      data: undefined,
    } as unknown as ReturnType<typeof useImportBatches>);
    ui(<ImportsPage />);
    expect(
      screen.getByRole('heading', { name: 'Past imports need a connection' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  describe('history removal', () => {
    const batch = (id: string, undoneAt: string | null) => ({
      id,
      fileName: `${id}.csv`,
      undoneAt,
      createdAt: '2026-10-01T10:00:00Z',
      accountId: 'savings',
      rowCount: 1,
      importedCount: 1,
      duplicateCount: 0,
      rejectedCount: 0,
    });
    const show = (batches: ReturnType<typeof batch>[]) => {
      vi.mocked(useHasFamily).mockReturnValue(false);
      vi.mocked(useReviewQueue).mockReturnValue({ data: [] } as unknown as ReturnType<
        typeof useReviewQueue
      >);
      vi.mocked(useImportBatches).mockReturnValue({
        isSuccess: true,
        data: batches,
      } as unknown as ReturnType<typeof useImportBatches>);
      ui(<ImportsPage />);
    };
    const undone = '2026-10-02T10:00:00Z';

    it('removes an undone import with its icon and offers it on undone rows only', () => {
      show([batch('live', null), batch('gone', undone)]);
      expect(screen.queryByRole('button', { name: 'Remove live.csv from history' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Remove gone.csv from history' }));
      expect(removeMutate).toHaveBeenCalledWith('gone');
    });

    it('clears all undone imports after a confirmation with their count', () => {
      show([batch('live', null), batch('a', undone), batch('b', undone)]);
      fireEvent.click(screen.getByRole('button', { name: 'Clear undone imports' }));
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent('2 undone imports are removed from the history');
      expect(dialog).toHaveTextContent('Entries do not change.');
      expect(clearMutate).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
      expect(clearMutate).toHaveBeenCalled();
    });

    it('has no clear button without undone imports', () => {
      show([batch('live', null)]);
      expect(screen.queryByRole('button', { name: 'Clear undone imports' })).toBeNull();
    });

    it('disables both controls offline', () => {
      online.value = false;
      show([batch('gone', undone)]);
      expect(screen.getByRole('button', { name: 'Clear undone imports' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Remove gone.csv from history' })).toBeDisabled();
    });
  });
});

describe('ReviewPage', () => {
  beforeEach(() => vi.mocked(useLocalTransactions).mockReturnValue({ ready: true, items: [] }));

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

  it('offers a suggested transfer, chosen on both rows of a pair awaiting review', () => {
    const family = { id: 'w2', kind: 'family', name: 'Home' } as Workspace;
    vi.mocked(useWorkspaces).mockReturnValue({ ready: true, items: [personal, family] });
    vi.mocked(useHasFamily).mockReturnValue(true);
    const pendingRow = (id: string, kind: Category['kind'], accountId: string) =>
      ({
        transaction: {
          id,
          kind,
          accountId,
          amountMinor: 3000,
          currency: 'EUR',
          occurredOn: '2026-10-05',
          description: id,
          categoryId: null,
          transferId: null,
        },
        familyCategoryId: null,
      }) as unknown as ReviewItem;
    const queue = [
      {
        ...pendingRow('out', 'expense', 'card'),
        transferSuggestion: { counterpartId: 'in', reason: 'counterpart' },
      },
      {
        ...pendingRow('in', 'income', 'savings'),
        transferSuggestion: { counterpartId: 'out', reason: 'counterpart' },
      },
      {
        ...pendingRow('own', 'expense', 'card'),
        transferSuggestion: { counterpartId: null, reason: 'keyword' },
      },
      {
        ...pendingRow('gone', 'expense', 'card'),
        transferSuggestion: { counterpartId: 'elsewhere', reason: 'counterpart' },
      },
      {
        ...pendingRow('paid', 'expense', 'card'),
        transferSuggestion: { counterpartId: 'received', reason: 'counterpart' },
      },
      {
        ...pendingRow('late', 'expense', 'card'),
        transferSuggestion: { counterpartId: 'linked', reason: 'counterpart' },
      },
      pendingRow('shop', 'expense', 'card'),
    ] as ReviewItem[];
    const confirmed = (id: string, transferId: string | null) =>
      ({ id, accountId: 'savings', occurredOn: '2026-10-07', transferId }) as TransactionEntry;
    vi.mocked(useLocalTransactions).mockReturnValue({
      ready: true,
      items: [confirmed('received', null), confirmed('linked', 'x')],
    });
    vi.mocked(useReviewQueue).mockReturnValue({
      isPending: false,
      isSuccess: true,
      isError: false,
      data: queue,
    } as unknown as ReturnType<typeof useReviewQueue>);
    ui(<ReviewPage />);

    const rowOf = (description: string) =>
      screen.getByRole('checkbox', { name: `Select ${description}` }).closest('li')!;
    expect(rowOf('out')).toHaveTextContent(
      'Looks like a transfer · Other side: Savings, Oct 5, 2026',
    );
    expect(rowOf('own')).toHaveTextContent('Own account outside the app');
    expect(screen.queryByRole('button', { name: 'Transfer: gone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Transfer: shop' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Transfer: late' })).not.toBeInTheDocument();
    expect(rowOf('paid')).toHaveTextContent('Other side: Savings, Oct 7, 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Transfer: out' }));
    expect(screen.getByRole('button', { name: 'Transfer: in' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const description of ['out', 'in']) {
      expect(
        screen.queryByRole('combobox', { name: `Category: ${description}` }),
      ).not.toBeInTheDocument();
      expect(rowOf(description)).toHaveTextContent('Personal, no category: it is a transfer');
    }

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select out' }));
    expect(screen.getByRole('checkbox', { name: 'Select in' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Publish 2 rows' }));
    expect(confirmMutate).toHaveBeenCalledWith(
      [
        {
          transactionId: 'out',
          scope: 'personal',
          categoryId: null,
          transfer: { counterpartId: 'in' },
        },
        {
          transactionId: 'in',
          scope: 'personal',
          categoryId: null,
          transfer: { counterpartId: 'out' },
        },
      ],
      expect.anything(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Transfer: in' }));
    expect(screen.getByRole('button', { name: 'Transfer: out' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('combobox', { name: 'Category: out' })).toBeInTheDocument();
  });
});

describe('bulkCategoryChoice', () => {
  it('leaves a row outside the bulk scope, of another kind, or a transfer as it was', () => {
    const groceries = category('c1', 'expense');
    const kept = { scope: 'personal', categoryId: 'c0' } as const;
    expect(bulkCategoryChoice(kept, 'expense', 'family', groceries)).toBe(kept);
    expect(
      bulkCategoryChoice({ scope: 'family', categoryId: null }, 'income', 'family', groceries),
    ).toEqual({ scope: 'family', categoryId: null });
    expect(
      bulkCategoryChoice({ scope: 'family', categoryId: null }, 'expense', 'family', groceries),
    ).toEqual({ scope: 'family', categoryId: 'c1' });
    const transfer = transferChoice(null);
    expect(bulkCategoryChoice(transfer, 'expense', 'personal', groceries)).toBe(transfer);
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
