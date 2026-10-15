import type { components } from './api.gen';
import { api } from './client';
import { present } from './session';
import type { Account, Category } from './sync';

export type AccountCreate = components['schemas']['CreateAccountDto'];
export type AccountPatch = components['schemas']['UpdateAccountDto'];
export type CategoryCreate = components['schemas']['CreateCategoryDto'];
export type CategoryPatch = components['schemas']['UpdateCategoryDto'];

export async function createAccount(body: AccountCreate): Promise<Account> {
  return present((await api.POST('/api/v1/accounts', { body })).data);
}

export async function updateAccount(id: string, body: AccountPatch): Promise<Account> {
  return present(
    (await api.PATCH('/api/v1/accounts/{id}', { params: { path: { id } }, body })).data,
  );
}

export async function createCategory(body: CategoryCreate): Promise<Category> {
  return present((await api.POST('/api/v1/categories', { body })).data);
}

export async function updateCategory(id: string, body: CategoryPatch): Promise<Category> {
  return present(
    (await api.PATCH('/api/v1/categories/{id}', { params: { path: { id } }, body })).data,
  );
}
