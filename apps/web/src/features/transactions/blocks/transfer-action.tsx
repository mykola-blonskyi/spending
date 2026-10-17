import { ArrowLeftRight, Unlink } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from '@i18n/index';
import { MoneyText } from '@shared/components';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@shared/ui/dialog';
import { useTransfer } from '../use-transfer';
import { ConfirmButton } from './entry-fields';

const OUTSIDE = 'outside';
const option =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors duration-150 ease-out hover:bg-muted/60 has-[:checked]:border-foreground has-[:checked]:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring';

/**
 * "This is a transfer" for an ordinary entry, "Not a transfer" for a side of one (BR-36). Both
 * write locally and sync like any edit.
 */
export function TransferButton({ id, className }: { id: string; className?: string }) {
  const t = useTranslations('transfer');
  const form = useTranslations('transactionForm');
  const transfer = useTransfer(id);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>(OUTSIDE);
  const name = useId();
  const failed = () => toast.error(form('saveFailed'));

  if (transfer.isTransfer) {
    return (
      <ConfirmButton
        icon={Unlink}
        label={t('unmark')}
        title={t('unmarkTitle')}
        description={t('unmarkDescription')}
        className={className}
        onConfirm={() => void transfer.unmark().then(() => toast(t('unmarked')), failed)}
      />
    );
  }

  const confirm = () => {
    setOpen(false);
    void transfer.mark(choice === OUTSIDE ? null : choice).then(() => toast(t('marked')), failed);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setChoice(transfer.candidates[0]?.id ?? OUTSIDE);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className={cn('h-11', className)}>
          <ArrowLeftRight aria-hidden />
          {t('mark')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('markTitle')}</DialogTitle>
          <DialogDescription>{t('markDescription')}</DialogDescription>
        </DialogHeader>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t('otherSide')}</legend>
          <div className="-mx-1 flex max-h-[45vh] flex-col gap-2 overflow-y-auto px-1 py-0.5">
            {transfer.candidates.map((row) => (
              <label key={row.id} className={option}>
                <input
                  type="radio"
                  name={name}
                  value={row.id}
                  checked={choice === row.id}
                  onChange={() => setChoice(row.id)}
                  className="size-4 shrink-0 accent-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{row.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[row.accountName, row.dateLabel].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <MoneyText
                  amountMinor={row.kind === 'income' ? row.amountMinor : -row.amountMinor}
                  currency={row.currency}
                  signDisplay="exceptZero"
                  colored
                  className="shrink-0 tabular"
                />
              </label>
            ))}
            {transfer.candidates.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('noCandidates')}</p>
            )}
            <label className={option}>
              <input
                type="radio"
                name={name}
                value={OUTSIDE}
                checked={choice === OUTSIDE}
                onChange={() => setChoice(OUTSIDE)}
                className="size-4 shrink-0 accent-foreground"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t('outside')}</span>
                <span className="block text-xs text-muted-foreground">{t('outsideHint')}</span>
              </span>
            </label>
          </div>
        </fieldset>
        <DialogFooter>
          <Button type="button" onClick={confirm} className="h-11 active:scale-[0.97]">
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
