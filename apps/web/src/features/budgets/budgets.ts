import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { components } from '@data/api.gen';
import { errorCode } from '@data/api-error';
import { api } from '@data/client';
import { isSignedOutError, present } from '@data/session';
import type { CategoryView } from '@features/ledger';
import { useTranslations } from '@i18n/index';
import type { Month } from './month';

export type Budget = components['schemas']['BudgetDto_Output'];
export type BudgetInput = components['schemas']['PutBudgetDto'];

export const BUDGETS_KEY = ['budgets'];

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

/** Expense categories of the workspace that can still get a budget (PUT upserts per category). */
export function budgetableCategories(
  categories: readonly CategoryView[],
  workspaceId: string,
  budgets: readonly Pick<Budget, 'categoryId'>[],
): CategoryView[] {
  const budgeted = new Set(budgets.map((budget) => budget.categoryId));
  return categories.filter(
    (category) =>
      category.workspaceId === workspaceId &&
      category.kind === 'expense' &&
      !category.archived &&
      !budgeted.has(category.id),
  );
}
