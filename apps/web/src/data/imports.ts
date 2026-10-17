import { queryOptions } from '@tanstack/react-query';
import type { components } from './api.gen';
import { api } from './client';
import { present } from './session';

type Schemas = components['schemas'];
export type ImportBody = Schemas['ImportDto'];
export type ImportRow = ImportBody['rows'][number];
export type ImportResult = Schemas['ImportResultDto_Output'];
export type ImportBatch = Schemas['ImportBatchView_Output'];
export type RejectReason = ImportResult['rejected'][number]['reason'];
export type UndoResult = Schemas['UndoResultDto_Output'];
export type ReviewItem = Schemas['ReviewListDto_Output']['items'][number];
export type ConfirmItem = Schemas['ConfirmDto']['items'][number];
export type LearnItem = Schemas['LearnDto']['items'][number];

export const importBatchesQuery = queryOptions({
  queryKey: ['imports'],
  queryFn: async ({ signal }) =>
    present((await api.GET('/api/v1/imports', { signal })).data).batches,
});

export const reviewQueueQuery = queryOptions({
  queryKey: ['imports', 'review'],
  queryFn: async ({ signal }) =>
    present((await api.GET('/api/v1/imports/review', { signal })).data).items,
});

export async function createImport(body: ImportBody): Promise<ImportResult> {
  return present((await api.POST('/api/v1/imports', { body })).data);
}

export async function undoImport(id: string): Promise<UndoResult> {
  return present((await api.POST('/api/v1/imports/{id}/undo', { params: { path: { id } } })).data);
}

export async function confirmReview(items: ConfirmItem[]) {
  return present((await api.POST('/api/v1/imports/review/confirm', { body: { items } })).data)
    .transactions;
}

export async function learnCategories(items: LearnItem[]): Promise<void> {
  await api.POST('/api/v1/imports/learn', { body: { items } });
}
