import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import type { ImportResult } from '@data/imports';
import { useTranslations } from '@i18n/index';
import { Button } from '@shared/ui/button';
import { Table, Td, Th, Tr } from './table';

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-pretty text-muted-foreground">{hint}</dd>}
    </div>
  );
}

export function ImportSummary({
  result,
  accountName,
  onImportAnother,
}: {
  result: ImportResult;
  accountName: string;
  onImportAnother: () => void;
}) {
  const t = useTranslations('imports');
  const { batch, imported, duplicates, rejected } = result;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t('summary.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('summary.description', { fileName: batch.fileName, account: accountName })}
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-3">
        <Stat label={t('summary.imported')} value={imported.count} />
        <Stat label={t('summary.duplicates')} value={duplicates} />
        <Stat label={t('summary.rejected')} value={rejected.length} />
      </dl>

      {rejected.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">
            {t('summary.rejectedTitle')}
          </h2>
          <Table>
            <thead>
              <tr>
                <Th className="w-20">{t('summary.line')}</Th>
                <Th>{t('summary.reason')}</Th>
              </tr>
            </thead>
            <tbody>
              {rejected.map((row) => (
                <Tr key={row.line}>
                  <Td className="tabular-nums">{row.line}</Td>
                  <Td>{t(`reasons.${row.reason}`)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={onImportAnother}>
          {t('summary.importAnother')}
        </Button>
        <Button asChild variant="ghost">
          <Link to="/transactions">
            {t('summary.openHistory')}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
