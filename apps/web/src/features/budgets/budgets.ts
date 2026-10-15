import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { components } from '@data/api.gen';
import { errorCode } from '@data/api-error';
import { api } from '@data/client';
import { isSignedOutError, present } from '@data/session';
import { type Category, useSyncStatus } from '@data/sync';
import { useTranslations } from '@i18n/index';
import type { Month } from './month';

export type Budget = components['schemas']['BudgetDto_Output'];
export type BudgetInput = components['schemas']['PutBudgetDto'];

const BUDGETS_KEY = ['budgets'];

export const budgetsQuery = (month: Month) =>
  queryOptions({
    queryKey: [...BUDGETS_KEY, month],
    queryFn: async ({ signal }) =>
      present((await api.GET('/api/v1/budgets', { params: { query: { month } }, signal })).data)
        .budgets,
    // Progress moves with every synced transaction, including ones recorded on other screens.
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

function useBudgetMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BUDGETS_KEY }),
    onError: (error) => {
      if (!isSignedOutError(error)) toast.error(t(`errors.${errorCode(error)}`));
    },
  });
}

export const usePutBudget = () =>
  useBudgetMutation(async (body: BudgetInput): Promise<Budget> =>
    present((await api.PUT('/api/v1/budgets', { body })).data),
  );

export const useDeleteBudget = () =>
  useBudgetMutation(async (id: string): Promise<void> => {
    await api.DELETE('/api/v1/budgets/{id}', { params: { path: { id } } });
  });

/** A refetch that fails while a list is on screen is told, not swapped for an error state. */
export function useRefetchErrorToast(query: UseQueryResult<unknown>): void {
  const t = useTranslations();
  const toasted = useRef(0);
  const { isError, error, errorUpdatedAt, data, isPlaceholderData } = query;
  useEffect(() => {
    if (!isError || data === undefined || isPlaceholderData) return;
    if (toasted.current === errorUpdatedAt) return;
    toasted.current = errorUpdatedAt;
    if (!isSignedOutError(error)) toast.error(t(`errors.${errorCode(error)}`));
  }, [isError, error, errorUpdatedAt, data, isPlaceholderData, t]);
}

/** Spending reaches the server through sync, so a finished sync may have moved progress. */
export function useRefreshBudgetsOnSync(): void {
  const state = useSyncStatus()?.state;
  const queryClient = useQueryClient();
  const previous = useRef(state);
  useEffect(() => {
    if (state === 'synced' && previous.current !== undefined && previous.current !== 'synced') {
      void queryClient.invalidateQueries({ queryKey: BUDGETS_KEY });
    }
    previous.current = state;
  }, [state, queryClient]);
}

/** Expense categories of the workspace that can still get a budget (PUT upserts per category). */
export function budgetableCategories(
  categories: readonly Category[],
  workspaceId: string,
  budgets: readonly Pick<Budget, 'categoryId'>[],
): Category[] {
  const budgeted = new Set(budgets.map((budget) => budget.categoryId));
  return categories.filter(
    (category) =>
      category.workspaceId === workspaceId &&
      category.kind === 'expense' &&
      category.archivedAt === null &&
      !budgeted.has(category.id),
  );
}
