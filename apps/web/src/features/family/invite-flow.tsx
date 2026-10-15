import { MailOpen, MailX, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ApiError, errorCode } from '@data/api-error';
import { acceptInvitation, invitationPreviewQuery } from '@data/family';
import { sessionQuery } from '@data/session';
import { loginHref } from '@features/auth';
import { useTranslations } from '@i18n/index';
import { EmptyState, ErrorState, LoadingState } from '@shared/components';
import { formatDate } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { Button } from '@shared/ui/button';
import { useFamily, useFamilyMutation } from './family';

const card = 'w-full border-solid bg-card';

/** Every reason a link cannot be used reads the same, so the page is no state oracle (BR-8). */
const isInvalid = (error: unknown) =>
  error instanceof ApiError && error.status >= 400 && error.status < 500;

/**
 * An invitation link: the preview is public, joining needs a session. A signed-out visitor's
 * Join goes through sign-in and comes back here to accept.
 */
export function InviteFlow({ token }: { token: string }) {
  const t = useTranslations();
  const { locale } = useSharedLocale();
  const navigate = useNavigate();
  const session = useQuery(sessionQuery);
  const signedIn = Boolean(session.data);
  const family = useFamily(signedIn);
  // Someone already in a family cannot join another, so their preview is never requested.
  const preview = useQuery({
    ...invitationPreviewQuery(token),
    enabled: !signedIn || family.data === null,
  });
  const accept = useFamilyMutation(acceptInvitation, (joined) => {
    toast.success(t('invite.joined', { family: joined.name }));
    void navigate('/family', { replace: true });
  });

  if (family.data) {
    return (
      <EmptyState
        className={card}
        icon={Users}
        title={t('invite.alreadyTitle')}
        description={t('invite.alreadyDescription', { family: family.data.name })}
        action={
          <Button asChild size="lg">
            <Link to="/family">{t('invite.openFamily')}</Link>
          </Button>
        }
      />
    );
  }
  const error = session.error ?? family.error ?? accept.error ?? preview.error;
  if (error) {
    if (isInvalid(error) && errorCode(error) !== 'FAMILY_EXISTS') {
      return (
        <EmptyState
          className={card}
          icon={MailX}
          title={t('invite.invalidTitle')}
          description={t('invite.invalidDescription')}
          action={
            <Button asChild variant="outline">
              <Link to="/">{t('actions.goHome')}</Link>
            </Button>
          }
        />
      );
    }
    return (
      <ErrorState
        className={card}
        title={t('states.error.title')}
        description={t(`errors.${errorCode(error)}`)}
        onRetry={() => void (family.error ? family.refetch() : preview.refetch())}
      />
    );
  }
  if (!preview.data || session.data === undefined || (signedIn && family.data === undefined)) {
    return <LoadingState rows={3} className="w-full" />;
  }

  const name = preview.data.familyName;
  const join = t('invite.accept', { family: name });
  return (
    <EmptyState
      className={card}
      icon={MailOpen}
      title={t('invite.title', { family: name })}
      description={`${t('invite.description', { owner: preview.data.ownerName })} ${t('invite.validUntil', { date: formatDate(preview.data.expiresAt, locale) })}`}
      action={
        <div className="flex w-full flex-col gap-2">
          {signedIn ? (
            <Button size="lg" disabled={accept.isPending} onClick={() => accept.mutate(token)}>
              {join}
            </Button>
          ) : (
            <Button asChild size="lg">
              <a href={loginHref(`/invite/${encodeURIComponent(token)}`)}>{join}</a>
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link to="/">{t('invite.notNow')}</Link>
          </Button>
        </div>
      }
    />
  );
}
