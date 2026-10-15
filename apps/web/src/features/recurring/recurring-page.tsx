import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { CloudOff, Pause, Pencil, Play, Plus, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { errorCode } from '@data/api-error';
import { useCategories } from '@data/sync';
import { useRefetchErrorToast } from '@features/budgets';
import { useTranslations } from '@i18n/index';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  MoneyText,
  PageHeader,
} from '@shared/components';
import { formatDate, formatRelativeDay } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { RECURRING_PATH, type Rule, rulesQuery, useDeleteRule, useUpdateRule } from './rules';
import { scheduleWords } from './schedule-text';

export function RulesUnavailable({ query }: { query: UseQueryResult<Rule[]> }) {
  const t = useTranslations();
  const offline =
    (query.fetchStatus === 'paused' && query.data === undefined) ||
    (query.isError && errorCode(query.error) === 'NETWORK');
  if (offline) {
    return (
      <EmptyState
        icon={CloudOff}
        title={t('recurring.offlineTitle')}
        description={t('recurring.offlineDescription')}
      />
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        title={t(`errors.${errorCode(query.error)}`)}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <LoadingState variant="cards" rows={3} />;
}

/** BR-24: deleting a rule keeps the entries it generated. */
export function DeleteRuleDialog({
  rule,
  onClose,
  onConfirmed,
}: {
  rule: Rule | null;
  onClose: () => void;
  onConfirmed?: () => void;
}) {
  const t = useTranslations('recurring');
  const remove = useDeleteRule();
  return (
    <ConfirmDialog
      open={rule !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('deleteTitle')}
      description={t('deleteDescription')}
      confirmLabel={t('delete')}
      onConfirm={() => {
        if (rule) remove.mutate(rule.id);
        onClose();
        onConfirmed?.();
      }}
    />
  );
}

export function RecurringPage() {
  const t = useTranslations();
  const query = useQuery(rulesQuery);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  useRefetchErrorToast(query);
  const rules = query.data;
  const newRule = (
    <Button asChild size="lg">
      <Link to={`${RECURRING_PATH}/new`}>
        <Plus aria-hidden />
        {t('recurring.add')}
      </Link>
    </Button>
  );

  let body: React.ReactNode;
  if (rules === undefined) {
    body = <RulesUnavailable query={query} />;
  } else if (rules.length === 0) {
    body = (
      <EmptyState
        icon={Repeat}
        title={t('pages.recurring.emptyTitle')}
        description={t('pages.recurring.emptyDescription')}
        action={newRule}
      />
    );
  } else {
    body = (
      <ul aria-label={t('pages.recurring.title')} className="grid gap-3 lg:grid-cols-2">
        {rules.map((rule) => (
          <RuleRow key={rule.id} rule={rule} onDelete={() => setDeleting(rule)} />
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t('pages.recurring.title')}
        description={t('pages.recurring.description')}
        actions={rules && rules.length > 0 && newRule}
      />
      {body}
      <DeleteRuleDialog rule={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function RuleRow({ rule, onDelete }: { rule: Rule; onDelete: () => void }) {
  const t = useTranslations();
  const tRecurring = useTranslations('recurring');
  const { locale } = useSharedLocale();
  const categories = useCategories().items;
  const update = useUpdateRule();
  const category = categories.find((c) => c.id === rule.categoryId);
  const title = rule.description || category?.name || t('pages.transactions.uncategorized');
  const schedule = scheduleWords(rule, tRecurring, locale);
  const paused = rule.pausedAt !== null;

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="flex min-w-0 items-center gap-2 font-medium">
            <span className="truncate">{title}</span>
            {rule.scope === 'family' && (
              <Badge variant="secondary">{t('recurring.form.family')}</Badge>
            )}
          </h3>
          <p className="text-sm text-muted-foreground">
            {schedule.clampNote ? `${schedule.every}, ${schedule.clampNote}` : schedule.every}
          </p>
        </div>
        <MoneyText
          amountMinor={rule.kind === 'expense' ? -rule.amountMinor : rule.amountMinor}
          currency={rule.currency}
          colored
          className="font-medium"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {paused ? (
          <Badge variant="outline" className="text-warning-foreground">
            <Pause aria-hidden />
            {t('recurring.paused')}
          </Badge>
        ) : rule.nextOccurrence === null ? (
          <span className="text-muted-foreground">{t('recurring.ended')}</span>
        ) : (
          <span>
            {t('recurring.next', { date: formatRelativeDay(rule.nextOccurrence, locale) })}
          </span>
        )}
        {rule.endsOn && rule.nextOccurrence !== null && (
          <span className="text-muted-foreground">
            {t('recurring.until', { date: formatDate(rule.endsOn, locale) })}
          </span>
        )}
      </div>
      {paused && <p className="text-sm text-muted-foreground">{t('recurring.pausedNote')}</p>}

      <div className="-mx-2 mt-auto -mb-2 flex flex-wrap items-center justify-end gap-1">
        {rule.nextOccurrence !== null && (
          <Button
            variant="outline"
            size="sm"
            className="mr-auto ml-2 h-10"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: rule.id, patch: { paused: !paused } })}
          >
            {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
            {t(paused ? 'recurring.resume' : 'recurring.pause')}
          </Button>
        )}
        <Button asChild variant="ghost" size="sm" className="h-10 min-w-10">
          <Link to={`${RECURRING_PATH}/${rule.id}`}>
            <Pencil aria-hidden />
            <span className="sr-only sm:not-sr-only">{t('recurring.edit')}</span>
          </Link>
        </Button>
        <Button variant="ghost" size="sm" className="h-10 min-w-10" onClick={onDelete}>
          <Trash2 aria-hidden />
          <span className="sr-only sm:not-sr-only">{t('recurring.delete')}</span>
        </Button>
      </div>
    </li>
  );
}
