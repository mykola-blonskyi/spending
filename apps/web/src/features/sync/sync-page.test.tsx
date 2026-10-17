import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { localRow, sequentialIds, serverRow, syncedState } from '@data/sync/fixtures';
import type { LocalState } from '@data/sync/model';
import { reducePush } from '@data/sync/push';
import { applyLocalChange } from '@data/sync/queue';
import { testSession } from '@data/testing';
import { fakeLocalData, renderTransactionScreen } from '@features/transactions/test-helpers';
import { SyncPage } from './sync-page';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));

const renderSync = (state: LocalState) =>
  renderTransactionScreen(<SyncPage />, {
    data: fakeLocalData(state).value,
    path: '/sync',
    route: '/sync',
  });

const ids = sequentialIds();
const edit = (state: LocalState, patch: Parameters<typeof localRow>[0]) =>
  applyLocalChange(state, { type: 'upsert', row: localRow(patch) }, ids);

describe('the sync center', () => {
  it('says everything is in sync only when nothing waits', () => {
    renderSync(syncedState(serverRow()));
    expect(screen.getByText('Everything is in sync')).toBeVisible();
  });

  it('lists changes the server refused, with the reason, and changes still waiting', () => {
    const waiting = edit(syncedState(serverRow()), { description: 'Market run' });
    const refused = reducePush(
      edit(waiting, { id: 'tx-2', description: 'Bus fare' }),
      [{ mutationId: 'm-2', status: 'rejected', code: 'INVALID_CATEGORY', message: 'archived' }],
      '2026-10-15T00:00:00.000Z',
      ['m-2'],
    );
    renderSync(refused);

    expect(screen.queryByText('Everything is in sync')).toBeNull();
    const failed = screen.getByRole('region', { name: '1 change not synced' });
    const row = within(failed).getByRole('link', { name: /Bus fare/ });
    expect(row).toHaveAttribute('href', '/transactions/tx-2');
    expect(row).toHaveTextContent('Not synced: This category is archived');
    const pending = screen.getByRole('region', { name: '1 change waiting to sync' });
    expect(within(pending).getByRole('link', { name: /Market run/ })).toHaveTextContent(
      'Waiting to sync',
    );
  });
});
