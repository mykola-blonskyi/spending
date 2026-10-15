import { api } from './client';
import { present } from './session';

export type ExportFormat = 'json' | 'csv';

export const DELETE_CONFIRMATION = 'DELETE MY DATA';

export async function fetchExport(format: ExportFormat): Promise<Blob> {
  return present(
    (await api.GET('/api/v1/me/export', { params: { query: { format } }, parseAs: 'blob' })).data,
  );
}

export async function deleteAccount(): Promise<void> {
  await api.DELETE('/api/v1/me', { body: { confirmation: DELETE_CONFIRMATION } });
}
