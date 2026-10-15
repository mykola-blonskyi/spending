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
 * Who recorded another member's family entry. When the account is hidden because it belongs to
 * that member (BR-3), the row says who paid instead. Nothing for personal or own entries.
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
  // A row this device created has no server author yet: it is the signed-in user's own.
  if (entry.scope !== 'family' || !entry.author || entry.author.userId === profile.id) return null;

  const name = entry.author.displayName ?? t('formerMember');
  const avatarUrl =
    members.data?.find((member) => member.userId === entry.author?.userId)?.avatarUrl ?? null;

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <UserAvatar user={{ displayName: name, avatarUrl }} className="size-4 text-[9px]" />
      <span className="truncate">{entry.accountId === null ? t('paidBy', { name }) : name}</span>
    </span>
  );
}
