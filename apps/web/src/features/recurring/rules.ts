import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { components } from '@data/api.gen';
import { errorCode } from '@data/api-error';
import { api } from '@data/client';
import { rulesQuery } from '@data/recurring';
import { isSignedOutError, present } from '@data/session';
import { useSyncNow } from '@data/sync';
import { useTranslations } from '@i18n/index';

export type Rule = components['schemas']['RuleDto_Output'];
export type RuleInput = components['schemas']['CreateRuleDto'];
export type RulePatch = components['schemas']['UpdateRuleDto'];

export const RECURRING_PATH = '/recurring';

/** `pull`: the server may have generated entries just now, which reach the device on a sync (D2). */
function useRuleMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  pull: boolean,
) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const syncNow = useSyncNow();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      if (pull) void syncNow();
      await queryClient.invalidateQueries({ queryKey: rulesQuery.queryKey });
    },
    onError: (error) => {
      if (!isSignedOutError(error)) toast.error(t(`errors.${errorCode(error)}`));
    },
  });
}

export const useCreateRule = () =>
  useRuleMutation(
    async (body: RuleInput): Promise<Rule> =>
      present((await api.POST('/api/v1/recurring-rules', { body })).data),
    true,
  );

export const useUpdateRule = () =>
  useRuleMutation(
    async ({ id, patch }: { id: string; patch: RulePatch }): Promise<Rule> =>
      present(
        (await api.PATCH('/api/v1/recurring-rules/{id}', { params: { path: { id } }, body: patch }))
          .data,
      ),
    true,
  );

export const useDeleteRule = () =>
  useRuleMutation(async (id: string): Promise<void> => {
    await api.DELETE('/api/v1/recurring-rules/{id}', { params: { path: { id } } });
  }, false);
