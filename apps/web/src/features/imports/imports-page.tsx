import { ClipboardCheck, FileUp, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { ImportBatch } from '@data/imports';
import { QueryUnavailable } from '@data/query-unavailable';
import { useAccounts } from '@data/sync';
import { useTranslations } from '@i18n/index';
import { ConfirmDialog, EmptyState, PageHeader } from '@shared/components';
import { formatDate } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { useOnlineStatus } from '@shared/lib/network';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card } from '@shared/ui/card';
import { useHasFamily, useImportBatches, useReviewQueue, useUndoImport } from './imports';

const NEW_IMPORT_PATH = '/imports/new';
export const REVIEW_PATH = '/imports/review';

function ReviewBanner({ count }: { count: number }) {
  const t = useTranslations('imports.review');
  return (
    <Card className="flex-row items-center gap-4 px-5 py-4">
      <ClipboardCheck aria-hidden className="size-5 shrink-0 text-primary" />
      <p className="flex-1 text-sm text-pretty">{t('banner', { count })}</p>
      <Button asChild variant="outline" size="sm">
        <Link to={REVIEW_PATH}>{t('open')}</Link>
      </Button>
    </Card>
  );
}

function BatchRow({
  batch,
  accountName,
  onUndo,
}: {
  batch: ImportBatch;
  accountName: string;
  onUndo: () => void;
}) {
  const t = useTranslations('imports.history');
  const { locale } = useSharedLocale();
  const online = useOnlineStatus();
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{batch.fileName}</span>
          {batch.undoneAt && <Badge variant="secondary">{t('undone')}</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">
          {accountName} · {formatDate(batch.createdAt, locale)} ·{' '}
          {t('rows', { count: batch.rowCount })}
        </span>
        <span className="text-xs text-muted-foreground">
          {t('counts', {
            imported: batch.importedCount,
            duplicates: batch.duplicateCount,
            rejected: batch.rejectedCount,
          })}
        </span>
      </div>
      {!batch.undoneAt && (
        <Button variant="outline" size="sm" disabled={!online} onClick={onUndo}>
          <Undo2 aria-hidden />
          {t('undo')}
        </Button>
      )}
    </li>
  );
}

export function ImportsPage() {
  const t = useTranslations();
  const online = useOnlineStatus();
  const batches = useImportBatches();
  const accounts = useAccounts();
  const hasFamily = useHasFamily();
  const review = useReviewQueue();
  const undo = useUndoImport();
  const [undoing, setUndoing] = useState<ImportBatch | null>(null);
  const accountName = (id: string | null) =>
    accounts.items.find((account) => account.id === id)?.name ??
    t('imports.history.removedAccount');
  const pendingReview = review.data?.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('pages.imports.title')}
        description={t('pages.imports.description')}
        actions={
          online ? (
            <Button asChild>
              <Link to={NEW_IMPORT_PATH}>
                <FileUp aria-hidden />
                {t('imports.start')}
              </Link>
            </Button>
          ) : (
            <Button disabled>
              <FileUp aria-hidden />
              {t('imports.start')}
            </Button>
          )
        }
      />
      {!online && <p className="text-sm text-muted-foreground">{t('imports.offline')}</p>}
      {hasFamily && pendingReview > 0 && <ReviewBanner count={pendingReview} />}

      {!batches.isSuccess ? (
        <QueryUnavailable
          query={batches}
          offlineTitle={t('imports.offlineTitle')}
          offlineDescription={t('imports.offlineDescription')}
        />
      ) : batches.data.length === 0 ? (
        <EmptyState
          icon={FileUp}
          title={t('pages.imports.emptyTitle')}
          description={t('pages.imports.emptyDescription')}
        />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">
            {t('imports.history.title')}
          </h2>
          <Card className="gap-0 py-0">
            <ul aria-label={t('imports.history.title')} className="divide-y">
              {batches.data.map((batch) => (
                <BatchRow
                  key={batch.id}
                  batch={batch}
                  accountName={accountName(batch.accountId)}
                  onUndo={() => setUndoing(batch)}
                />
              ))}
            </ul>
          </Card>
        </section>
      )}

      <ConfirmDialog
        open={undoing !== null}
        onOpenChange={(open) => !open && setUndoing(null)}
        title={t('imports.history.undoTitle')}
        description={t('imports.history.undoDescription')}
        confirmLabel={t('imports.history.undo')}
        onConfirm={() => {
          const batch = undoing;
          setUndoing(null);
          if (!batch) return;
          undo.mutate(batch.id, {
            onSuccess: ({ deleted, kept }) =>
              toast.success(t('imports.history.undoResult', { deleted, kept })),
          });
        }}
      />
    </div>
  );
}
