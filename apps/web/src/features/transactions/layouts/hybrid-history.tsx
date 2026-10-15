import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import { Button } from '@shared/ui/button';
import { MasterDetail } from '../blocks';
import { useHistory } from '../use-history';
import { CalmDay, CalmRow, CalmToolbar } from './calm-history';

/** Hybrid: the calm history, with the selected entry beside the list on desktop. */
export function HybridHistory() {
  const t = useTranslations();
  const history = useHistory();
  return (
    <MasterDetail
      history={history}
      header={
        <div className="flex flex-col gap-4">
          <PageHeader
            title={t('pages.transactions.title')}
            description={t('pages.transactions.description')}
            actions={
              <Button asChild className="max-lg:hidden">
                <Link to="/transactions/new">
                  <Plus aria-hidden />
                  {t('nav.addTransaction')}
                </Link>
              </Button>
            }
          />
          <CalmToolbar history={history} />
        </div>
      }
      scroll="window"
      estimate={{ day: 44, entry: 61 }}
      renderDay={(day) => <CalmDay day={day} />}
      renderEntry={(row, position, selected) => (
        <CalmRow row={row} position={position} selected={selected} />
      )}
      className="items-start gap-6"
      listClassName="gap-4"
      detailClassName="rounded-xl border bg-card lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto"
    />
  );
}
