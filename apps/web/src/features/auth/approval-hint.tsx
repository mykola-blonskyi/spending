import { Hourglass, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslations } from '@i18n/index';
import { dismissApprovalHint, shouldShowApprovalHint } from './signin-attempts';

/** Shown after repeated sign-ins that never came back: the likely cause is a pending approval or grant. */
export function ApprovalHint() {
  const t = useTranslations('signin.pendingHint');
  const titleId = useId();
  const [visible, setVisible] = useState(shouldShowApprovalHint);
  if (!visible) return null;

  return (
    <section
      aria-labelledby={titleId}
      className="relative flex animate-in gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 pr-11 text-sm duration-200 ease-out fade-in-0 slide-in-from-top-1"
    >
      <Hourglass aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="font-medium">
          {t('title')}
        </h2>
        <p className="text-pretty text-muted-foreground">{t('description')}</p>
      </div>
      <button
        type="button"
        aria-label={t('dismiss')}
        onClick={() => {
          dismissApprovalHint();
          setVisible(false);
        }}
        className="absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60"
      >
        <X aria-hidden className="size-4" />
      </button>
    </section>
  );
}
