import { useQuery } from '@tanstack/react-query';
import { workspacesQuery } from '@data/family';
import type { TransactionEntry } from '@data/sync';
import { useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { UserAvatar } from '@shared/components';
import { cn } from '@shared/lib/utils';
import { findFamily } from './family';

const familyMembers = (workspaces: Parameters<typeof findFamily>[0]) =>
  findFamily(workspaces)?.members ?? [];

/**
 * Who recorded a family entry. When the account is hidden because it belongs to another member
 * (BR-3), the row says who paid instead. Nothing for personal entries.
 */
export function AuthorBadge({
  entry,
  className,
}: {
  entry: Pick<TransactionEntry, 'scope' | 'author' | 'accountId'>;
  className?: string;
}) {
  const t = useTranslations('family.author');
  const profile = useProfile();
  const members = useQuery({ ...workspacesQuery, select: familyMembers });
  if (entry.scope !== 'family') return null;

  // A row this device created has no server author yet: it is the signed-in user's.
  const author = entry.author ?? { userId: profile.id, displayName: profile.displayName };
  const name = author.displayName ?? t('formerMember');
  const self = author.userId === profile.id;
  const avatarUrl = self
    ? profile.avatarUrl
    : (members.data?.find((member) => member.userId === author.userId)?.avatarUrl ?? null);

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <UserAvatar user={{ displayName: name, avatarUrl }} className="size-4 text-[9px]" />
      <span className="truncate">
        {!self && entry.accountId === null ? t('paidBy', { name }) : name}
      </span>
    </span>
  );
}
