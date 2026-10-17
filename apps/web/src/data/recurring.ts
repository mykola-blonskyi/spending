import { queryOptions } from '@tanstack/react-query';
import { api } from './client';
import { present } from './session';

export const rulesQuery = queryOptions({
  queryKey: ['recurring-rules'],
  queryFn: async ({ signal }) =>
    present((await api.GET('/api/v1/recurring-rules', { signal })).data).rules,
});
