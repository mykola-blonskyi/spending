import { Delete } from 'lucide-react';
import { useTranslations } from '@i18n/index';
import { cn } from '@shared/lib/utils';
import { KEYPAD_KEYS, type KeypadKey } from '../form-model';

/** A 3x4 amount keypad. `separator` is the locale's decimal mark. */
export function Keypad({
  onKey,
  separator,
  className,
  keyClassName,
}: {
  onKey: (key: KeypadKey) => void;
  separator: string;
  className?: string;
  keyClassName?: string;
}) {
  const t = useTranslations('transactionForm');
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {KEYPAD_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onKey(key)}
          aria-label={
            key === 'backspace'
              ? t('backspace')
              : key === 'separator'
                ? t('decimalSeparator')
                : undefined
          }
          className={cn(
            'flex h-12 min-h-11 items-center justify-center rounded-xl bg-muted text-xl font-medium tabular transition-[background-color,transform] duration-150 ease-out outline-none select-none hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/60 active:scale-[0.97]',
            keyClassName,
          )}
        >
          {key === 'backspace' ? (
            <Delete aria-hidden className="size-5" />
          ) : key === 'separator' ? (
            separator
          ) : (
            key
          )}
        </button>
      ))}
    </div>
  );
}
