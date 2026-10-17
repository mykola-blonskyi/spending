import { MousePointerClick } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslations } from '@i18n/index';
import { EmptyState } from '@shared/components';
import { useIsDesktop } from '@shared/lib/media';
import { cn } from '@shared/lib/utils';
import { useHistoryView } from '../history-view';
import type { History } from '../use-history';
import { HISTORY_PATH } from '../use-entry-form';
import { EntryDetail } from './entry-detail';
import { HistoryList } from './history-list';
import { HistoryStatus } from './history-status';

type ListProps = ComponentProps<typeof HistoryList>;

type MasterDetailProps = {
  history: History;
  /** Search, filters and totals above the list. */
  header: ReactNode;
  renderDay: ListProps['renderDay'];
  renderEntry: ListProps['renderEntry'];
  estimate?: ListProps['estimate'];
  /** How the desktop list scrolls: inside its pane (`self`) or with the page (`window`). */
  scroll: 'self' | 'window';
  className?: string;
  listClassName?: string;
  statusClassName?: string;
  detailClassName?: string;
};

/**
 * The history list beside the selected entry (`/transactions/:id`) on desktop; on phones the
 * selected entry replaces the list. Registered for both routes so the list stays mounted.
 */
export function MasterDetail({
  history,
  header,
  renderDay,
  renderEntry,
  estimate,
  scroll,
  className,
  listClassName,
  statusClassName,
  detailClassName,
}: MasterDetailProps) {
  const t = useTranslations();
  const desktop = useIsDesktop();
  const view = useHistoryView();
  const navigate = useNavigate();
  const { selectedId } = history;

  if (!desktop && selectedId) {
    return (
      <EntryDetail key={selectedId} id={selectedId} onBack={() => void navigate(HISTORY_PATH)} />
    );
  }

  const list = (
    <section className={cn('flex min-w-0 flex-col', listClassName)}>
      {header}
      <HistoryStatus status={history.status} loaded={history.loaded} className={statusClassName} />
      {history.status === 'ready' && (
        <div className={cn(desktop && scroll === 'self' && 'min-h-0 flex-1')}>
          <HistoryList
            items={history.items}
            label={t('pages.transactions.title')}
            scroll={desktop ? scroll : 'window'}
            estimate={estimate}
            selectedId={selectedId}
            renderDay={renderDay}
            renderEntry={renderEntry}
          />
        </div>
      )}
    </section>
  );
  if (!desktop) return list;

  return (
    <div
      className={cn(
        'grid',
        // The table needs the width; the selected entry keeps a phone-sized pane beside it.
        view === 'table' ? 'grid-cols-[minmax(0,1fr)_400px]' : 'grid-cols-[380px_minmax(0,1fr)]',
        className,
      )}
    >
      {list}
      <section aria-label={t('history.detail.label')} className={cn('min-w-0', detailClassName)}>
        {selectedId ? (
          <EntryDetail key={selectedId} id={selectedId} />
        ) : (
          <EmptyState
            icon={MousePointerClick}
            title={t('history.detail.placeholderTitle')}
            description={t('history.detail.placeholderDescription')}
            className="m-8 border-0"
          />
        )}
      </section>
    </div>
  );
}
