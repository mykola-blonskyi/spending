import type { components } from './api.gen';
import { api } from './client';
import { present } from './session';

export type DataExport = components['schemas']['DataExportDto'];

export const DELETE_CONFIRMATION = 'DELETE MY DATA';

/** The JSON export as a file, to save as is. */
export async function fetchExport(): Promise<Blob> {
  return present((await api.GET('/api/v1/me/export', { parseAs: 'blob' })).data);
}

/** The same export as a document, to build the CSV on the device. */
export async function fetchExportData(): Promise<DataExport> {
  return present((await api.GET('/api/v1/me/export', { parseAs: 'json' })).data);
}

export async function deleteAccount(): Promise<void> {
  await api.DELETE('/api/v1/me', { body: { confirmation: DELETE_CONFIRMATION } });
}
