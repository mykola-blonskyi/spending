import { inArray } from 'drizzle-orm';
import type { Tx } from '../database/database.module';
import { accounts, categories } from '../database/schema';
import type { EntryKind } from './views';

export type AccountFact = Readonly<{ workspaceId: string; archived: boolean; currency: string }>;
export type CategoryFact = Readonly<{ workspaceId: string; kind: EntryKind; archived: boolean }>;

/** The account and category facts the reference rules need, by id; a missing id is absent. */
export async function loadReferenceFacts(
  tx: Tx,
  accountIds: readonly (string | null)[],
  categoryIds: readonly (string | null)[],
): Promise<{
  accounts: ReadonlyMap<string, AccountFact>;
  categories: ReadonlyMap<string, CategoryFact>;
}> {
  const accountKeys = accountIds.filter((id) => id !== null);
  const categoryKeys = categoryIds.filter((id) => id !== null);
  const accountRows =
    accountKeys.length === 0
      ? []
      : await tx
          .select({
            id: accounts.id,
            workspaceId: accounts.workspaceId,
            archivedAt: accounts.archivedAt,
            currency: accounts.currency,
          })
          .from(accounts)
          .where(inArray(accounts.id, accountKeys));
  const categoryRows =
    categoryKeys.length === 0
      ? []
      : await tx
          .select({
            id: categories.id,
            workspaceId: categories.workspaceId,
            kind: categories.kind,
            archivedAt: categories.archivedAt,
          })
          .from(categories)
          .where(inArray(categories.id, categoryKeys));
  return {
    accounts: new Map(
      accountRows.map((r) => [
        r.id,
        { workspaceId: r.workspaceId, archived: r.archivedAt !== null, currency: r.currency },
      ]),
    ),
    categories: new Map(
      categoryRows.map((r) => [
        r.id,
        { workspaceId: r.workspaceId, kind: r.kind, archived: r.archivedAt !== null },
      ]),
    ),
  };
}

export type ReferenceFacts = Readonly<{
  workspaceId: string;
  kind: EntryKind;
  currency: string;
  accountId: string | null;
  categoryId: string | null;
  /** The references the row or rule already has, which stay allowed even when archived. */
  current: { accountId: string | null; categoryId: string | null } | null;
  isAuthor: boolean;
  authorPersonalWorkspaceId: string | null;
  account: AccountFact | null;
  category: CategoryFact | null;
}>;

/** BR-3, BR-4, BR-39 reference rules, shared by sync upserts, recurring rule templates and import review. */
export function referenceError(
  facts: ReferenceFacts,
): 'INVALID_ACCOUNT' | 'INVALID_CATEGORY' | 'CURRENCY_MISMATCH' | null {
  const { account, category } = facts;
  if (facts.accountId !== null) {
    const unchanged = facts.current?.accountId === facts.accountId;
    // BR-3: only the author may pick their personal account; others may keep it.
    const allowed =
      account !== null &&
      (account.workspaceId === facts.workspaceId ||
        (account.workspaceId === facts.authorPersonalWorkspaceId && (facts.isAuthor || unchanged)));
    if (!allowed || (account.archived && !unchanged)) return 'INVALID_ACCOUNT';
    if (account.currency !== facts.currency) return 'CURRENCY_MISMATCH';
  }
  if (facts.categoryId !== null) {
    const unchanged = facts.current?.categoryId === facts.categoryId;
    if (
      category === null ||
      category.workspaceId !== facts.workspaceId ||
      category.kind !== facts.kind ||
      (category.archived && !unchanged)
    ) {
      return 'INVALID_CATEGORY';
    }
  }
  return null;
}

export type TransferPeer = Readonly<{
  workspaceId: string;
  kind: EntryKind;
  transferOutside: boolean;
}>;

/**
 * BR-37. A transfer has no category. A one-sided transfer stands alone; a linked side has at most
 * one other side, of the opposite kind, in the same workspace. Each side is its own upsert, so
 * the first side of a pair arrives alone and is valid.
 */
export function transferError(
  intended: Readonly<{
    workspaceId: string;
    kind: EntryKind;
    categoryId: string | null;
    transferId: string | null;
    transferOutside: boolean;
  }>,
  peers: readonly TransferPeer[],
): 'INVALID_TRANSFER' | null {
  if (intended.transferId === null) return intended.transferOutside ? 'INVALID_TRANSFER' : null;
  if (intended.categoryId !== null) return 'INVALID_TRANSFER';
  if (intended.transferOutside) return peers.length === 0 ? null : 'INVALID_TRANSFER';
  const [peer, ...more] = peers;
  const fits =
    !peer ||
    (more.length === 0 &&
      !peer.transferOutside &&
      peer.workspaceId === intended.workspaceId &&
      peer.kind !== intended.kind);
  return fits ? null : 'INVALID_TRANSFER';
}
