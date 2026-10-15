import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import { createAccount, createCategory, updateAccount, updateCategory } from './ledger';

vi.mock('./client', () => ({ api: { POST: vi.fn(), PATCH: vi.fn() } }));

const ID = '7d9f6a52-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.mocked(api.POST)
    .mockReset()
    .mockResolvedValue({ data: { id: ID } } as never);
  vi.mocked(api.PATCH)
    .mockReset()
    .mockResolvedValue({ data: { id: ID } } as never);
});

describe('ledger requests', () => {
  it('creates an account and a category with the body as given', async () => {
    const account = { workspaceId: ID, name: 'Cash', kind: 'cash', currency: 'EUR' } as const;
    const category = {
      workspaceId: ID,
      name: 'Pets',
      kind: 'expense',
      color: '#16a34a',
      icon: 'tag',
    } as const;

    await createAccount(account);
    await createCategory(category);

    expect(api.POST).toHaveBeenNthCalledWith(1, '/api/v1/accounts', { body: account });
    expect(api.POST).toHaveBeenNthCalledWith(2, '/api/v1/categories', { body: category });
  });

  it('patches by id and returns the saved row', async () => {
    const account = await updateAccount(ID, { archived: true });
    await updateCategory(ID, { name: 'Pets' });

    expect(account).toEqual({ id: ID });
    expect(api.PATCH).toHaveBeenNthCalledWith(1, '/api/v1/accounts/{id}', {
      params: { path: { id: ID } },
      body: { archived: true },
    });
    expect(api.PATCH).toHaveBeenNthCalledWith(2, '/api/v1/categories/{id}', {
      params: { path: { id: ID } },
      body: { name: 'Pets' },
    });
  });

  it('rejects an empty response', async () => {
    vi.mocked(api.POST).mockResolvedValue({ data: undefined } as never);
    await expect(
      createAccount({ workspaceId: ID, name: 'x', kind: 'cash', currency: 'EUR' }),
    ).rejects.toThrow();
  });
});
