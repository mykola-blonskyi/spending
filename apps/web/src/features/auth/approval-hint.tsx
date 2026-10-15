import { Hourglass } from 'lucide-react';
import { useId } from 'react';
import { useTranslations } from '@i18n/index';

/** Always shown: the usual reason a sign-in never gets through is a pending approval or grant. */
export function ApprovalHint() {
  const t = useTranslations('signin.pendingHint');
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      className="flex gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm"
    >
      <Hourglass aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="font-medium">
          {t('title')}
        </h2>
        <p className="text-pretty text-muted-foreground">{t('description')}</p>
      </div>
    </section>
  );
}
