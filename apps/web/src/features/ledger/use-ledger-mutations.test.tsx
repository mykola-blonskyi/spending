import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@data/api-error';
import { deleteAccount, updateAccount } from '@data/ledger';
import { createQueryClient } from '@data/query-client';
import { I18nProvider } from '@i18n/index';
import { useAccountsAdmin } from './use-ledger-mutations';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@data/ledger', () => ({
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
}));
vi.mock('@data/sync', () => ({ useSyncNow: () => refresh }));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={createQueryClient()}>
    <I18nProvider locale="en">{children}</I18nProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  refresh.mockResolvedValue(undefined);
});

describe('useAccountsAdmin', () => {
  it('refreshes the local store after a write and reports success', async () => {
    vi.mocked(updateAccount).mockResolvedValue({} as never);
    const { result } = renderHook(() => useAccountsAdmin(), { wrapper });

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.archive('a-1', true);
    });

    expect(saved).toBe(true);
    expect(updateAccount).toHaveBeenCalledWith('a-1', { archived: true });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps the write when the refresh fails', async () => {
    vi.mocked(updateAccount).mockResolvedValue({} as never);
    refresh.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useAccountsAdmin(), { wrapper });

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.update('a-1', { name: 'Cash' });
    });

    expect(saved).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('explains a failed write and does not refresh', async () => {
    vi.mocked(updateAccount).mockRejectedValue(
      new ApiError({ status: 409, code: 'NAME_TAKEN', message: 'taken' }),
    );
    const { result } = renderHook(() => useAccountsAdmin(), { wrapper });

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.update('a-1', { name: 'Cash' });
    });

    expect(saved).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('That name is already used. Pick another one.');
  });

  it('names why the server refused to delete an account (BR-41)', async () => {
    vi.mocked(deleteAccount).mockRejectedValue(
      new ApiError({ status: 409, code: 'ACCOUNT_IN_USE', message: 'in use' }),
    );
    const { result } = renderHook(() => useAccountsAdmin(), { wrapper });

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await result.current.remove('a-1');
    });

    expect(deleted).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      'This account has entries or recurring rules now, so it cannot be deleted. Archive it instead.',
    );
  });
});
