import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@data/api-error';
import { deleteAccount, fetchExport } from '@data/data-rights';
import { clearLocalUserData } from '@data/local-data';
import { createQueryClient } from '@data/query-client';
import { testSession } from '@data/testing';
import { I18nProvider } from '@i18n/index';
import { loadPage } from '@shared/lib/navigation';
import { DataRightsSection } from './data-rights-section';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@shared/lib/navigation', () => ({ loadPage: vi.fn() }));
vi.mock('@data/local-data', () => ({ clearLocalUserData: vi.fn() }));
vi.mock(import('@data/data-rights'), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchExport: vi.fn(),
  deleteAccount: vi.fn(),
}));

function setup() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nProvider locale="en">
        <MemoryRouter>
          <DataRightsSection />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

async function confirmDeletion(phrase: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
  await userEvent.type(screen.getByLabelText('Confirmation phrase'), phrase);
  await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:export');
  URL.revokeObjectURL = vi.fn();
});

describe('DataRightsSection', () => {
  it('downloads the JSON and CSV exports', async () => {
    vi.mocked(fetchExport).mockResolvedValue(new Blob(['x']));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    setup();

    await userEvent.click(screen.getByRole('button', { name: /Download JSON/ }));
    await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetchExport).mock.calls.map(([format]) => format)).toEqual(['json', 'csv']);
  });

  it('explains the consequences and keeps deletion locked until the phrase is typed', async () => {
    setup();

    expect(screen.getByText(/Former member/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    const confirm = screen.getByRole('button', { name: 'Delete account' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Confirmation phrase'), 'DELETE MY DATA');
    expect(confirm).toBeEnabled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('clears local data and leaves for sign-in after deleting', async () => {
    vi.mocked(deleteAccount).mockResolvedValue(undefined);
    setup();

    await confirmDeletion('DELETE MY DATA');

    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/signin'));
    expect(vi.mocked(clearLocalUserData).mock.calls[0]?.[1]).toBe(testSession().user.id);
  });

  it('sends a family owner with other members to the family screen', async () => {
    vi.mocked(deleteAccount).mockRejectedValue(
      new ApiError({ status: 409, code: 'FAMILY_OWNER_MUST_TRANSFER', message: 'x' }),
    );
    setup();

    await confirmDeletion('DELETE MY DATA');

    expect(await screen.findByText('You own a family with other members')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to family settings' })).toHaveAttribute(
      'href',
      '/family',
    );
    expect(loadPage).not.toHaveBeenCalled();
    expect(clearLocalUserData).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
