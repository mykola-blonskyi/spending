import { useQuery } from '@tanstack/react-query';
import { Info, SearchX, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useWorkspaces } from '@data/sync';
import { useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { EmptyState, LoadingState, PageHeader } from '@shared/components';
import { todayIn } from '@shared/format';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { type RuleFormValues, valuesFromRule } from './form-values';
import { DeleteRuleDialog, RulesUnavailable } from './recurring-page';
import { RuleForm } from './rule-form';
import { RECURRING_PATH, rulesQuery, useCreateRule, useUpdateRule } from './rules';

export function NewRulePage() {
  const t = useTranslations();
  const navigate = useNavigate();
  const profile = useProfile();
  const workspaces = useWorkspaces().items;
  const create = useCreateRule();
  const personal = workspaces.find((workspace) => workspace.kind === 'personal');
  const family = workspaces.find((workspace) => workspace.kind === 'family');
  const initial = useMemo<RuleFormValues>(
    () => ({
      kind: 'expense',
      amount: '',
      currency: 'EUR',
      accountId: null,
      categoryId: null,
      description: '',
      frequency: 'monthly',
      interval: '1',
      startsOn: todayIn(profile.timezone),
      endsOn: '',
      timezone: profile.timezone,
    }),
    [profile.timezone],
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t('pages.recurring.newTitle')}
        description={t('pages.recurring.newDescription')}
      />
      {personal ? (
        <RuleForm
          initial={initial}
          workspaceId={personal.id}
          scopes={family ? { personal: personal.id, family: family.id } : null}
          submitLabel={t('recurring.form.create')}
          onSubmit={async (input) => {
            try {
              await create.mutateAsync(input);
              await navigate(RECURRING_PATH);
            } catch {
              // useCreateRule already explained the failure; the form stays to retry.
            }
          }}
        />
      ) : (
        <LoadingState rows={6} />
      )}
    </div>
  );
}

export function EditRulePage() {
  const t = useTranslations();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useQuery(rulesQuery);
  const update = useUpdateRule();
  const [confirming, setConfirming] = useState(false);
  const rule = query.data?.find((candidate) => candidate.id === id);

  const header = (
    <PageHeader
      title={t('pages.recurring.editTitle')}
      description={t('pages.recurring.editDescription')}
    />
  );
  if (!rule) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        {query.data === undefined ? (
          <RulesUnavailable query={query} />
        ) : (
          <EmptyState
            icon={SearchX}
            title={t('pages.recurring.notFoundTitle')}
            description={t('pages.recurring.notFoundDescription')}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {header}
      <Alert role="note" className="max-w-xl">
        <Info aria-hidden />
        <AlertDescription>{t('recurring.editNote')}</AlertDescription>
      </Alert>
      <RuleForm
        key={rule.id}
        initial={valuesFromRule(rule)}
        workspaceId={rule.workspaceId}
        scopes={null}
        submitLabel={t('recurring.form.save')}
        onSubmit={async ({ workspaceId: _workspaceId, ...patch }) => {
          try {
            await update.mutateAsync({ id: rule.id, patch });
            await navigate(RECURRING_PATH);
          } catch {
            // useUpdateRule already explained the failure; the form stays to retry.
          }
        }}
        footer={
          <Button type="button" variant="outline" size="lg" onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden />
            {t('recurring.delete')}
          </Button>
        }
      />
      <DeleteRuleDialog
        rule={confirming ? rule : null}
        onClose={() => setConfirming(false)}
        onConfirmed={() => void navigate(RECURRING_PATH)}
      />
    </div>
  );
}
