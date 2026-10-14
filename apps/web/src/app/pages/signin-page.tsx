import { AlertCircle, Info, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { ApprovalHint, loginHref, recordSignInAttempt, safeReturnTo } from '@features/auth';
import { useTranslations } from '@i18n/index';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { BrandMark } from '../brand';
import { LanguageSelect } from '../language-select';

const LOGIN_ERRORS = ['login_failed', 'login_expired'] as const;
type LoginError = (typeof LOGIN_ERRORS)[number];

const isLoginError = (value: string | null): value is LoginError =>
  LOGIN_ERRORS.includes(value as LoginError);

const SESSION_END_REASONS = ['AUTH_REQUIRED', 'SESSION_REVOKED'] as const;
type SessionEndReason = (typeof SESSION_END_REASONS)[number];

const isSessionEndReason = (value: string | null): value is SessionEndReason =>
  SESSION_END_REASONS.includes(value as SessionEndReason);

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

export function SignInPage() {
  const t = useTranslations();
  const [params] = useSearchParams();
  const error = params.get('error');
  const reason = params.get('reason');
  const returnTo = safeReturnTo(params.get('returnTo'));

  return (
    <div className="flex min-h-dvh flex-col bg-background px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-end py-4">
        <LanguageSelect compact />
      </div>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 pb-16">
        <div className="flex flex-col items-center gap-5 text-center">
          <BrandMark className="size-14" />
          <div className="flex flex-col gap-2">
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-balance">
              {t('signin.title')}
            </h1>
            <p className="text-pretty text-muted-foreground">{t('signin.subtitle')}</p>
          </div>
        </div>

        {isLoginError(error) ? (
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
            <AlertCircle aria-hidden />
            <AlertDescription>{t(`signin.errors.${error}`)}</AlertDescription>
          </Alert>
        ) : (
          isSessionEndReason(reason) && (
            <Alert>
              <Info aria-hidden />
              <AlertDescription>{t(`errors.${reason}`)}</AlertDescription>
            </Alert>
          )
        )}

        <ApprovalHint />

        <div className="flex flex-col gap-4">
          <a
            href={loginHref(returnTo)}
            onClick={recordSignInAttempt}
            className="flex h-12 items-center justify-center gap-3 rounded-xl border bg-card text-[15px] font-medium shadow-xs transition-[background-color,transform] duration-150 ease-out outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/60 active:scale-[0.97]"
          >
            <GoogleIcon />
            {t('signin.continueWithGoogle')}
          </a>
          <div className="flex gap-3 rounded-xl bg-muted/60 p-4 text-sm">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-pretty text-muted-foreground">{t('signin.approvalNote')}</p>
          </div>
        </div>

        <p className="text-center text-xs text-pretty text-muted-foreground">
          {t('states.signInHelp')}
        </p>
      </main>
    </div>
  );
}
