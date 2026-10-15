import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLocalUserData } from '../local-data';
import { createQueryClient } from '../query-client';
import { localRow } from './fixtures';
import { queueOrder } from './model';
import {
  acquireLocalStore,
  databaseName,
  localDatabaseNames,
  LocalStore,
  releaseLocalStore,
  countUnsentMutations,
} from './store';
import { recordTransaction } from './writes';

const draft = (({ id: _id, createdAt: _createdAt, ...rest }) => rest)(localRow());

async function databases(): Promise<string[]> {
  return (await indexedDB.databases()).map((db) => db.name ?? '');
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const name of await databases()) indexedDB.deleteDatabase(name);
  localStorage.clear();
});

describe('LocalStore', () => {
  it('keeps each user in their own database and lists it in the device registry', async () => {
    const ann = await LocalStore.open('ann');
    const bob = await LocalStore.open('bob');
    await recordTransaction(ann, draft);
    ann.close();
    bob.close();

    expect(localDatabaseNames()).toEqual([databaseName('ann'), databaseName('bob')]);
    const annAgain = await LocalStore.open('ann');
    const bobAgain = await LocalStore.open('bob');
    expect(annAgain.state.transactions.size).toBe(1);
    expect(bobAgain.state.transactions.size).toBe(0);
    annAgain.close();
    bobAgain.close();
  });

  it('persists the overlay and its queued mutation together', async () => {
    const store = await LocalStore.open('ann');
    const id = await recordTransaction(store, draft);
    store.close();

    const reopened = await LocalStore.open('ann');
    expect(reopened.state.transactions.get(id)?.local).toMatchObject({ amountMinor: 1250 });
    expect(queueOrder(reopened.state)).toMatchObject([{ transactionId: id }]);
    reopened.close();
  });

  it('writes neither the overlay nor the mutation when the transaction aborts', async () => {
    const store = await LocalStore.open('ann');
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'mutations') throw new DOMException('Disk full', 'QuotaExceededError');
      return put.apply(this, args);
    });

    await expect(recordTransaction(store, draft)).rejects.toThrow('Disk full');
    expect(store.state.transactions.size).toBe(0);
    vi.restoreAllMocks();
    store.close();

    const reopened = await LocalStore.open('ann');
    expect(reopened.state.transactions.size).toBe(0);
    expect(reopened.state.mutations.size).toBe(0);
    reopened.close();
  });

  it('builds each write from the disk, so two tabs never reuse a queue position', async () => {
    const tabA = await LocalStore.open('ann');
    const tabB = await LocalStore.open('ann');
    await recordTransaction(tabA, draft);
    await recordTransaction(tabB, draft);

    expect(queueOrder(tabB.state).map((mutation) => mutation.seq)).toEqual([1, 2]);
    expect(tabB.state.transactions.size).toBe(2);
    tabA.close();
    tabB.close();
  });

  it('keeps a commit that is already on disk when the store closes meanwhile', async () => {
    const store = await LocalStore.open('ann');
    const written = store.commit((state) => {
      store.close();
      return { ...state, meta: { ...state.meta, cursor: 7 } };
    });

    await expect(written).resolves.toMatchObject({ meta: { cursor: 7 } });
    const reopened = await LocalStore.open('ann');
    expect(reopened.state.meta.cursor).toBe(7);
    reopened.close();
  });

  it('tells listeners about real changes and other tabs’ commits, not about no-op commits', async () => {
    const tabA = await LocalStore.open('ann');
    const tabB = await LocalStore.open('ann');
    const heard = vi.fn();
    tabB.subscribe(heard);

    await tabB.commit((state) => state);
    expect(heard).not.toHaveBeenCalled();

    const reloaded = new Promise<void>((resolve) => tabB.subscribe(resolve));
    await recordTransaction(tabA, draft);
    await reloaded;
    expect(tabB.state.transactions.size).toBe(1);
    tabA.close();
    tabB.close();
  });
});

describe('local user data', () => {
  it('reports unsent changes and deletes the database and registry entry on sign-out', async () => {
    const store = await acquireLocalStore('ann');
    expect(countUnsentMutations('ann')).toBe(0);
    await recordTransaction(store, draft);
    expect(countUnsentMutations('ann')).toBe(1);

    await clearLocalUserData(createQueryClient(), 'ann');

    expect(store.closed).toBe(true);
    expect(await databases()).not.toContain(databaseName('ann'));
    expect(localDatabaseNames()).toEqual([]);
    releaseLocalStore('ann');
  });

  it('cannot count unsent changes while no store is open', async () => {
    expect(countUnsentMutations('ann')).toBeNull();
    const store = await acquireLocalStore('ann');
    store.close();
    expect(countUnsentMutations('ann')).toBeNull();
    releaseLocalStore('ann');
  });
});
