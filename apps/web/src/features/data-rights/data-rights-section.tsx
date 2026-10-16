import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { errorCode } from '@data/api-error';
import {
  DELETE_CONFIRMATION,
  deleteAccount,
  fetchExport,
  fetchExportData,
} from '@data/data-rights';
import { clearLocalUserData } from '@data/local-data';
import { useSession } from '@features/auth';
import { categoryView } from '@features/ledger';
import { useTranslations } from '@i18n/index';
import { ConfirmDialog } from '@shared/components';
import { loadPage } from '@shared/lib/navigation';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card } from '@shared/ui/card';
import { transactionsCsv } from './transactions-csv';

function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Safari cancels the download when the URL is revoked in the same task as the click.
  setTimeout(() => URL.revokeObjectURL(url));
}

export function DataRightsSection() {
  const t = useTranslations();
  const defaults = useTranslations('categoryDefaults');
  const queryClient = useQueryClient();
  const { user } = useSession();
  const [confirming, setConfirming] = useState(false);

  const download = useMutation({
    mutationFn: async (format: 'json' | 'csv') => {
      if (format === 'json') return saveFile(await fetchExport(), 'spending-export.json');
      const csv = transactionsCsv(await fetchExportData(), {
        header: (column) => t(`settings.dataRights.export.columns.${column}`),
        category: (category) => categoryView(category, defaults).name,
        formerMember: t('family.author.formerMember'),
      });
      // The byte order mark makes spreadsheet apps read it as UTF-8.
      saveFile(
        new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }),
        'spending-transactions.csv',
      );
    },
    onError: (error) => toast.error(t(`errors.${errorCode(error)}`)),
  });

  const remove = useMutation({
    mutationFn: deleteAccount,
    onSuccess: async () => {
      try {
        await clearLocalUserData(queryClient, user.id);
      } finally {
        loadPage('/signin');
      }
    },
    onError: (error) => {
      if (errorCode(error) !== 'FAMILY_OWNER_MUST_TRANSFER')
        toast.error(t(`errors.${errorCode(error)}`));
    },
  });

  const ownerBlocked =
    remove.error !== null && errorCode(remove.error) === 'FAMILY_OWNER_MUST_TRANSFER';

  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 text-sm font-medium text-muted-foreground">
        {t('settings.dataRights.title')}
      </h2>
      <Card className="gap-0 divide-y py-0">
        <div className="flex flex-col gap-3 p-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-medium">{t('settings.dataRights.export.title')}</h3>
            <p className="text-sm text-pretty text-muted-foreground">
              {t('settings.dataRights.export.description')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['json', 'csv'] as const).map((format) => (
              <Button
                key={format}
                variant="outline"
                disabled={download.isPending}
                onClick={() => download.mutate(format)}
              >
                <Download aria-hidden />
                {t(`settings.dataRights.export.${format}`)}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 p-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-medium">{t('settings.dataRights.delete.title')}</h3>
            <p className="text-sm text-pretty text-muted-foreground">
              {t('settings.dataRights.delete.intro')}
            </p>
            <ul className="list-disc pl-5 text-sm text-pretty text-muted-foreground">
              {(['personal', 'family', 'sessions', 'local'] as const).map((item) => (
                <li key={item}>{t(`settings.dataRights.delete.consequences.${item}`)}</li>
              ))}
            </ul>
          </div>
          {ownerBlocked && (
            <Alert variant="destructive">
              <AlertTitle>{t('settings.dataRights.delete.ownerTitle')}</AlertTitle>
              <AlertDescription>
                <p>{t('settings.dataRights.delete.ownerDescription')}</p>
                <Link to="/family" className="underline underline-offset-2">
                  {t('settings.dataRights.delete.ownerLink')}
                </Link>
              </AlertDescription>
            </Alert>
          )}
          <div>
            <Button
              variant="destructive"
              disabled={remove.isPending || remove.isSuccess}
              onClick={() => {
                remove.reset();
                setConfirming(true);
              }}
            >
              <Trash2 aria-hidden />
              {t('settings.dataRights.delete.action')}
            </Button>
          </div>
        </div>
      </Card>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('settings.dataRights.delete.confirmTitle')}
        description={t('settings.dataRights.delete.confirmDescription')}
        confirmLabel={t('settings.dataRights.delete.confirm')}
        confirmPhrase={DELETE_CONFIRMATION}
        onConfirm={() => {
          setConfirming(false);
          remove.mutate();
        }}
      />
    </section>
  );
}
