import { Crown, Link2, MoreHorizontal, UserMinus, Users } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorCode } from '@data/api-error';
import {
  createFamily,
  createInvitation,
  type CreatedInvitation,
  deleteFamily,
  eventsQuery,
  type FamilyEvent,
  type FamilyMember,
  type Invitation,
  invitationsQuery,
  leaveFamily,
  removeMember,
  revokeInvitation,
  transferOwnership,
  type WorkspaceView,
} from '@data/family';
import { useSession } from '@features/auth';
import { useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import {
  ConfirmDialog,
  ErrorState,
  LoadingState,
  PageHeader,
  UserAvatar,
} from '@shared/components';
import { formatDate } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card } from '@shared/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { useFamily, useFamilyMutation } from './family';

const EXPIRY_DAYS = [1, 3, 7, 14, 30] as const;
const DEFAULT_EXPIRY = 7;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function CreateFamily() {
  const t = useTranslations('family.create');
  const nameId = useId();
  const [name, setName] = useState('');
  const create = useFamilyMutation(createFamily, () => toast.success(t('created')));
  const trimmed = name.trim();

  return (
    <Card className="gap-5 p-6">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Users aria-hidden className="size-6" strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-base font-semibold text-balance">{t('title')}</h2>
          <p className="text-sm text-pretty text-muted-foreground">{t('description')}</p>
        </div>
      </div>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) create.mutate(trimmed);
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={nameId}>{t('nameLabel')}</Label>
          <Input
            id={nameId}
            value={name}
            maxLength={60}
            autoComplete="off"
            placeholder={t('namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={!trimmed || create.isPending}>
          {t('submit')}
        </Button>
      </form>
    </Card>
  );
}

function MemberRow({
  member,
  isSelf,
  canManage,
}: {
  member: FamilyMember;
  isSelf: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('family');
  const { locale } = useSharedLocale();
  const timeZone = useProfile().timezone;
  const [confirming, setConfirming] = useState<'remove' | 'transfer' | null>(null);
  const remove = useFamilyMutation(removeMember, () =>
    toast.success(t('members.removed', { name: member.displayName })),
  );
  const transfer = useFamilyMutation(transferOwnership, () =>
    toast.success(t('members.transferred', { name: member.displayName })),
  );
  const name = member.displayName;

  return (
    <li className="flex items-center gap-3 p-4 sm:px-5">
      <UserAvatar user={member} className="size-10" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">
            {name}
            {isSelf && <span className="font-normal text-muted-foreground"> ({t('you')})</span>}
          </span>
          <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
            {member.role === 'owner' && <Crown aria-hidden />}
            {t(`roles.${member.role}`)}
          </Badge>
        </span>
        <span className="truncate text-sm text-muted-foreground">
          {t('members.joined', { date: formatDate(member.joinedAt, locale, { timeZone }) })}
        </span>
      </div>
      {canManage && !isSelf && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={t('members.actionsFor', { name })}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setConfirming('transfer')}>
              <Crown aria-hidden />
              {t('members.makeOwner')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirming('remove')}>
              <UserMinus aria-hidden />
              {t('members.remove')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ConfirmDialog
        open={confirming === 'remove'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t('members.removeTitle', { name })}
        description={t('members.removeDescription', { name })}
        confirmLabel={t('members.remove')}
        onConfirm={() => {
          setConfirming(null);
          remove.mutate(member.userId);
        }}
      />
      <ConfirmDialog
        open={confirming === 'transfer'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t('members.transferTitle', { name })}
        description={t('members.transferDescription', { name })}
        confirmLabel={t('members.transferConfirm')}
        onConfirm={() => {
          setConfirming(null);
          transfer.mutate(member.userId);
        }}
      />
    </li>
  );
}

function InvitationLink({ invitation }: { invitation: CreatedInvitation }) {
  const t = useTranslations('family.invitations');
  const linkId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invitation.url);
      toast.success(t('copied'));
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      toast.error(t('copyFailed'));
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 p-3">
      <Label htmlFor={linkId}>{t('linkLabel')}</Label>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          id={linkId}
          readOnly
          value={invitation.url}
          className="bg-background font-mono text-xs"
          onFocus={(event) => event.target.select()}
        />
        <Button type="button" variant="outline" onClick={() => void copy()}>
          <Link2 aria-hidden />
          {t('copy')}
        </Button>
      </div>
    </div>
  );
}

const STATE_VARIANT = {
  pending: 'default',
  accepted: 'secondary',
  revoked: 'outline',
  expired: 'outline',
} as const;

function InvitationRow({ invitation }: { invitation: Invitation }) {
  const t = useTranslations('family.invitations');
  const { locale } = useSharedLocale();
  const timeZone = useProfile().timezone;
  const revoke = useFamilyMutation(revokeInvitation, () => toast.success(t('revoked')));
  const detail =
    invitation.state === 'accepted' && invitation.acceptedBy
      ? t('acceptedBy', { name: invitation.acceptedBy.displayName })
      : invitation.state === 'pending'
        ? t('expires', {
            date: formatDate(invitation.expiresAt, locale, { timeStyle: 'short', timeZone }),
          })
        : t('createdOn', { date: formatDate(invitation.createdAt, locale, { timeZone }) });

  return (
    <li className="flex items-center gap-3 p-4 sm:px-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Badge variant={STATE_VARIANT[invitation.state]}>{t(`state.${invitation.state}`)}</Badge>
        <span className="truncate text-sm text-muted-foreground">{detail}</span>
      </div>
      {invitation.state === 'pending' && (
        <Button
          variant="outline"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate(invitation.id)}
        >
          {t('revoke')}
        </Button>
      )}
    </li>
  );
}

function Invitations() {
  const t = useTranslations('family.invitations');
  const tRoot = useTranslations();
  const expiryId = useId();
  const [days, setDays] = useState(DEFAULT_EXPIRY);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const invitations = useQuery(invitationsQuery);
  const create = useFamilyMutation(createInvitation, setCreated);

  return (
    <Card className="gap-0 divide-y py-0">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <p className="text-sm text-pretty text-muted-foreground">{t('description')}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={expiryId}>{t('expiry')}</Label>
            <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
              <SelectTrigger id={expiryId} className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_DAYS.map((count) => (
                  <SelectItem key={count} value={String(count)}>
                    {t('days', { count })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={create.isPending} onClick={() => create.mutate(days)}>
            <Link2 aria-hidden />
            {t('create')}
          </Button>
        </div>
        {created && <InvitationLink invitation={created} />}
      </div>
      {invitations.isError ? (
        <ErrorState
          className="py-8"
          title={t('title')}
          description={tRoot(`errors.${errorCode(invitations.error)}`)}
          onRetry={() => void invitations.refetch()}
        />
      ) : !invitations.data ? (
        <LoadingState rows={2} className="px-4" />
      ) : invitations.data.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground sm:px-5">{t('empty')}</p>
      ) : (
        <ul>
          {invitations.data.map((invitation) => (
            <InvitationRow key={invitation.id} invitation={invitation} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function EventRow({ event }: { event: FamilyEvent }) {
  const t = useTranslations('family.events');
  const { locale } = useSharedLocale();
  const timeZone = useProfile().timezone;
  const name = (person: FamilyEvent['actor']) => person?.displayName ?? t('formerMember');
  return (
    <li className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4 sm:px-5">
      <span className="text-sm">
        {t(event.type, { actor: name(event.actor), subject: name(event.subject) })}
      </span>
      <time dateTime={event.createdAt} className="shrink-0 text-xs text-muted-foreground">
        {formatDate(event.createdAt, locale, { timeStyle: 'short', timeZone })}
      </time>
    </li>
  );
}

function Events() {
  const t = useTranslations('family.events');
  const tRoot = useTranslations();
  const events = useQuery(eventsQuery);
  if (events.isError) {
    return (
      <ErrorState
        title={t('title')}
        description={tRoot(`errors.${errorCode(events.error)}`)}
        onRetry={() => void events.refetch()}
      />
    );
  }
  if (!events.data) return <LoadingState rows={3} />;
  if (events.data.length === 0) {
    return <p className="px-1 text-sm text-muted-foreground">{t('empty')}</p>;
  }
  return (
    <Card className="gap-0 py-0">
      <ol aria-label={t('title')} className="divide-y">
        {events.data.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </ol>
    </Card>
  );
}

function LeaveOrDelete({ family }: { family: WorkspaceView }) {
  const t = useTranslations('family');
  const [confirming, setConfirming] = useState(false);
  const leave = useFamilyMutation(leaveFamily, () => toast.success(t('leave.left')));
  const remove = useFamilyMutation(deleteFamily, () => toast.success(t('delete.deleted')));
  const owner = family.role === 'owner';

  return (
    <Card className="gap-0 divide-y py-0">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-medium">{owner ? t('delete.title') : t('leave.title')}</h3>
          <p className="text-sm text-pretty text-muted-foreground">
            {owner ? t('delete.description') : t('leave.description')}
          </p>
          {owner && <p className="text-sm text-pretty">{t('leave.ownerNote')}</p>}
        </div>
        <Button
          variant="destructive"
          className="shrink-0"
          disabled={leave.isPending || remove.isPending}
          onClick={() => setConfirming(true)}
        >
          {owner ? t('delete.action') : t('leave.action')}
        </Button>
      </div>
      {owner ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('delete.confirmTitle', { family: family.name })}
          description={t('delete.confirmDescription')}
          confirmLabel={t('delete.action')}
          confirmPhrase={family.name}
          onConfirm={() => {
            setConfirming(false);
            remove.mutate(family.name);
          }}
        />
      ) : (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('leave.confirmTitle', { family: family.name })}
          description={t('leave.confirmDescription')}
          confirmLabel={t('leave.action')}
          onConfirm={() => {
            setConfirming(false);
            leave.mutate(undefined);
          }}
        />
      )}
    </Card>
  );
}

function FamilyView({ family }: { family: WorkspaceView }) {
  const t = useTranslations('family');
  const { user } = useSession();
  const owner = family.role === 'owner';

  return (
    <>
      <PageHeader
        title={family.name}
        description={t('members.count', { count: family.members.length })}
      />
      <Section title={t('members.title')}>
        <Card className="gap-0 py-0">
          <ul aria-label={t('members.title')} className="divide-y">
            {family.members.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                isSelf={member.userId === user.id}
                canManage={owner}
              />
            ))}
          </ul>
        </Card>
      </Section>
      {owner && (
        <Section title={t('invitations.title')}>
          <Invitations />
        </Section>
      )}
      <Section title={t('events.title')}>
        <Events />
      </Section>
      <Section title={t('dangerZone')}>
        <LeaveOrDelete family={family} />
      </Section>
    </>
  );
}

export function FamilyPage() {
  const t = useTranslations();
  const family = useFamily();

  return (
    <div className="flex flex-col gap-8">
      {family.data ? (
        <FamilyView family={family.data} />
      ) : (
        <>
          <PageHeader title={t('pages.family.title')} description={t('pages.family.description')} />
          {family.data === null ? (
            <CreateFamily />
          ) : family.isError ? (
            <ErrorState
              title={t('states.error.title')}
              description={t(`errors.${errorCode(family.error)}`)}
              onRetry={() => void family.refetch()}
            />
          ) : (
            <LoadingState rows={3} />
          )}
        </>
      )}
    </div>
  );
}
