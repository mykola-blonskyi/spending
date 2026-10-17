import { type LucideIcon, Trash2, Undo2 } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { ScopeField } from '@features/family';
import { useTranslations } from '@i18n/index';
import { ConfirmDialog } from '@shared/components';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Textarea } from '@shared/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import type { EntryKind } from '../form-model';
import type { EntryForm } from '../use-entry-form';
import { CategoryBadge } from './category-badge';
import { ConversionNote } from './entry-amount';

const KINDS: readonly EntryKind[] = ['expense', 'income'];
const NONE = 'none';
const selectTrigger = 'h-11 w-full';

/** Seams a layout restyles a field through: the wrapper, the label and the control itself. */
type FieldStyle = {
  className?: string;
  labelClassName?: string;
  controlClassName?: string;
  /** Drawn at the control's left edge; the layout pads the control (`controlClassName`) to fit. */
  icon?: ReactNode;
};

function Field({
  id,
  label,
  className,
  labelClassName,
  icon,
  children,
}: {
  id: string;
  label: string;
  className?: string | undefined;
  labelClassName?: string | undefined;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} className={labelClassName}>
        {label}
      </Label>
      {icon ? (
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 z-10 flex -translate-y-1/2 items-center text-muted-foreground"
          >
            {icon}
          </span>
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function KindToggle({
  form,
  className,
  itemClassName,
  renderLabel = (_kind, label) => label,
}: {
  form: EntryForm;
  className?: string;
  itemClassName?: string;
  renderLabel?: (kind: EntryKind, label: string) => ReactNode;
}) {
  const t = useTranslations('transactionForm');
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      aria-label={t('kind')}
      value={form.values.kind}
      onValueChange={(kind) => (kind === 'income' || kind === 'expense') && form.setKind(kind)}
      className={cn('w-full', className)}
    >
      {KINDS.map((kind) => (
        <ToggleGroupItem key={kind} value={kind} className={cn('h-11 flex-1', itemClassName)}>
          {renderLabel(kind, t(kind))}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function ScopeChoice({ form }: { form: EntryForm }) {
  return form.scopeOffered ? <ScopeField value={form.scope} onValueChange={form.setScope} /> : null;
}

/** The typed amount: decimal keyboard on phones, the error tied to the input. */
export function AmountInput({
  form,
  className,
  labelClassName,
  inputClassName,
  inputMode = 'decimal',
}: {
  form: EntryForm;
  className?: string;
  labelClassName?: string;
  inputClassName?: string;
  /** `none` keeps the phone's keyboard away when the layout supplies its own keypad. */
  inputMode?: 'decimal' | 'none';
}) {
  const t = useTranslations('transactionForm');
  const id = useId();
  const invalid = form.errors.amount === 'invalid';
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} className={labelClassName}>
        {t('amount')}
      </Label>
      <Input
        id={id}
        inputMode={inputMode}
        autoComplete="off"
        placeholder="0"
        value={form.values.amount}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => form.set('amount', event.target.value)}
        className={cn('h-14 text-3xl font-semibold tabular md:text-3xl', inputClassName)}
      />
      {invalid && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {t('amountInvalid')}
        </p>
      )}
      <ConversionNote conversion={form.conversion} />
    </div>
  );
}

/** Categories of the entry's kind; pressing the chosen one again leaves the entry uncategorized. */
export function CategoryPicker({
  form,
  className,
  labelClassName,
  itemClassName,
  renderCategory = (category) => (
    <>
      <CategoryBadge category={category} className="size-8" />
      <span className="line-clamp-2 w-full leading-tight break-words hyphens-auto">
        {category.name}
      </span>
    </>
  ),
}: {
  form: EntryForm;
  className?: string;
  labelClassName?: string;
  itemClassName?: string;
  /** An item's content; style the chosen state with `group-data-[state=on]/item:` utilities. */
  renderCategory?: (category: EntryForm['categories'][number]) => ReactNode;
}) {
  const t = useTranslations('transactionForm');
  const labelId = useId();
  if (form.isTransfer) {
    return <p className="text-sm text-muted-foreground">{t('transferNoCategory')}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <Label id={labelId} className={labelClassName}>
        {t('category')}
      </Label>
      <ToggleGroup
        type="single"
        spacing={2}
        aria-labelledby={labelId}
        value={form.values.categoryId ?? ''}
        onValueChange={(next) => form.set('categoryId', next || null)}
        className={cn('grid w-full grid-cols-4 gap-2', className)}
      >
        {form.categories.map((category) => (
          <ToggleGroupItem
            key={category.id}
            value={category.id}
            title={category.name}
            className={cn(
              'group/item h-[4.5rem] w-full flex-col gap-1.5 rounded-xl border bg-card px-1 text-center text-[11px] whitespace-normal transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] data-[state=on]:border-primary data-[state=on]:bg-accent',
              itemClassName,
            )}
          >
            {renderCategory(category)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function AccountSelect({
  form,
  className,
  labelClassName,
  controlClassName,
  icon,
}: { form: EntryForm } & FieldStyle) {
  const t = useTranslations('transactionForm');
  const id = useId();
  return (
    <Field
      id={id}
      label={t('account')}
      className={className}
      labelClassName={labelClassName}
      icon={icon}
    >
      <Select
        value={form.values.accountId ?? NONE}
        onValueChange={(value) => form.setAccount(value === NONE ? null : value)}
      >
        <SelectTrigger id={id} className={cn(selectTrigger, controlClassName)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('noAccount')}</SelectItem>
          {form.accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function CurrencySelect({
  form,
  className,
  labelClassName,
  controlClassName,
  icon,
}: { form: EntryForm } & FieldStyle) {
  const t = useTranslations('transactionForm');
  const id = useId();
  return (
    <Field
      id={id}
      label={t('currency')}
      className={className}
      labelClassName={labelClassName}
      icon={icon}
    >
      <Select value={form.values.currency} onValueChange={(value) => form.set('currency', value)}>
        <SelectTrigger id={id} className={cn(selectTrigger, controlClassName)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {form.currencies.map((currency) => (
            <SelectItem key={currency} value={currency}>
              {currency}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function DateField({
  form,
  className,
  labelClassName,
  controlClassName,
  icon,
}: { form: EntryForm } & FieldStyle) {
  const t = useTranslations('transactionForm');
  const id = useId();
  return (
    <Field
      id={id}
      label={t('date')}
      className={className}
      labelClassName={labelClassName}
      icon={icon}
    >
      <Input
        id={id}
        type="date"
        required
        className={cn(
          'h-11',
          // With our own icon, the browser's calendar button is hidden but still covers the
          // field, so a click anywhere opens the picker.
          icon &&
            'relative [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:size-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0',
          controlClassName,
        )}
        value={form.values.occurredOn}
        onChange={(event) => event.target.value && form.set('occurredOn', event.target.value)}
      />
    </Field>
  );
}

export function DescriptionField({
  form,
  className,
  labelClassName,
  controlClassName,
  icon,
}: { form: EntryForm } & FieldStyle) {
  const t = useTranslations('transactionForm');
  const id = useId();
  return (
    <Field
      id={id}
      label={t('description')}
      className={className}
      labelClassName={labelClassName}
      icon={icon}
    >
      <Input
        id={id}
        maxLength={200}
        className={cn('h-11', controlClassName)}
        value={form.values.description}
        placeholder={t('descriptionPlaceholder')}
        onChange={(event) => form.set('description', event.target.value)}
      />
    </Field>
  );
}

export function NoteField({
  form,
  className,
  labelClassName,
  controlClassName,
  icon,
}: { form: EntryForm } & FieldStyle) {
  const t = useTranslations('transactionForm');
  const id = useId();
  return (
    <Field
      id={id}
      label={t('note')}
      className={className}
      labelClassName={labelClassName}
      icon={icon}
    >
      <Textarea
        id={id}
        rows={2}
        maxLength={2000}
        className={controlClassName}
        value={form.values.note}
        placeholder={t('notePlaceholder')}
        onChange={(event) => form.set('note', event.target.value)}
      />
    </Field>
  );
}

export function SaveBar({
  form,
  className,
  buttonClassName,
  children,
}: {
  form: EntryForm;
  className?: string;
  buttonClassName?: string;
  children?: ReactNode;
}) {
  const t = useTranslations('transactionForm');
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Button
        type="submit"
        disabled={form.submitting}
        className={cn('h-12 w-full text-base', buttonClassName)}
      >
        {t('save')}
      </Button>
      {children}
      <p className="text-center text-xs text-muted-foreground">{t('saveHint')}</p>
    </div>
  );
}

type ConfirmProps = { onConfirm: () => void; className?: string };

export function ConfirmButton({
  icon: Icon,
  label,
  title,
  description,
  onConfirm,
  className,
}: ConfirmProps & { icon: LucideIcon; label: string; title: string; description: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn('h-11', className)}
        onClick={() => setConfirming(true)}
      >
        <Icon aria-hidden />
        {label}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={title}
        description={description}
        confirmLabel={label}
        onConfirm={() => {
          setConfirming(false);
          onConfirm();
        }}
      />
    </>
  );
}

/** Deleting a side of a transfer deletes the whole transfer, so the dialog says so (BR-37). */
export function DeleteButton({
  transfer = false,
  ...props
}: ConfirmProps & { transfer?: boolean }) {
  const t = useTranslations('transactionForm');
  return (
    <ConfirmButton
      icon={Trash2}
      label={t('delete')}
      title={t(transfer ? 'deleteTransferTitle' : 'deleteTitle')}
      description={t(transfer ? 'deleteTransferDescription' : 'deleteDescription')}
      {...props}
    />
  );
}

/** Drops a change the server rejected, for an entry whose sync failed. */
export function DiscardButton(props: ConfirmProps) {
  const t = useTranslations('transactionForm');
  return (
    <ConfirmButton
      icon={Undo2}
      label={t('discard')}
      title={t('discardTitle')}
      description={t('discardDescription')}
      {...props}
    />
  );
}
