import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { useTranslations } from '@i18n/index';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { DASHBOARD_SCOPES, PERIOD_KINDS } from '../dashboard-model';
import { type Dashboard, usePeriodLabel } from '../use-dashboard';

/** Month, quarter, year or custom, then a stepper or the custom dates. */
export function PeriodControls({
  dashboard,
  className,
}: {
  dashboard: Dashboard;
  className?: string;
}) {
  const t = useTranslations('dashboard.period');
  const label = usePeriodLabel();
  const { period } = dashboard;
  const fromId = useId();
  const toId = useId();

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ToggleGroup
        type="single"
        variant="outline"
        aria-label={t('label')}
        value={period.kind}
        onValueChange={(kind) => {
          const chosen = PERIOD_KINDS.find((option) => option === kind);
          if (chosen) dashboard.choosePeriodKind(chosen);
        }}
        className="w-full @xl/main:w-auto"
      >
        {PERIOD_KINDS.map((kind) => (
          <ToggleGroupItem key={kind} value={kind} className="h-10 flex-1 px-3 @xl/main:flex-none">
            {t(kind)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {period.kind === 'custom' ? (
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fromId}>{t('from')}</Label>
            <Input
              id={fromId}
              type="date"
              required
              value={period.from}
              onChange={(event) =>
                event.target.value &&
                dashboard.setRange({ from: event.target.value, to: period.to })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={toId}>{t('to')}</Label>
            <Input
              id={toId}
              type="date"
              required
              value={period.to}
              onChange={(event) =>
                event.target.value &&
                dashboard.setRange({ from: period.from, to: event.target.value })
              }
            />
          </div>
          {dashboard.problem && (
            <p role="alert" className="basis-full text-sm text-destructive">
              {t(dashboard.problem)}
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-lg"
            aria-label={t('previous')}
            onClick={() => dashboard.step(-1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <p aria-live="polite" className="min-w-36 text-center text-lg font-semibold">
            {label(period)}
          </p>
          <Button
            variant="outline"
            size="icon-lg"
            aria-label={t('next')}
            disabled={!dashboard.canStepForward}
            onClick={() => dashboard.step(1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

/** Personal, family or both; offered only to family members (BR-12). */
export function ScopeSwitch({
  dashboard,
  className,
}: {
  dashboard: Dashboard;
  className?: string;
}) {
  const t = useTranslations('dashboard.scope');
  if (!dashboard.scopeOffered) return null;
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      aria-label={t('label')}
      value={dashboard.scope}
      onValueChange={(scope) => {
        const chosen = DASHBOARD_SCOPES.find((option) => option === scope);
        if (chosen) dashboard.setScope(chosen);
      }}
      className={cn('w-full @xl/main:w-auto', className)}
    >
      {DASHBOARD_SCOPES.map((scope) => (
        <ToggleGroupItem key={scope} value={scope} className="h-10 flex-1 px-3 @xl/main:flex-none">
          {t(scope)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
