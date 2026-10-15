import { useId, useRef, useState } from 'react';
import { useSharedLocale } from '@shared/lib/locale-context';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** When set, the confirm button stays disabled until this exact phrase is typed. */
  confirmPhrase?: string;
  /** A safer way out beside the confirm button, such as syncing before signing out. */
  alternative?: { label: string; onSelect: () => void };
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  confirmPhrase,
  alternative,
}: ConfirmDialogProps) {
  const { strings } = useSharedLocale();
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const opener = useRef<HTMLElement | null>(null);
  const blocked = confirmPhrase !== undefined && typed.trim() !== confirmPhrase;

  const handleOpenChange = (next: boolean) => {
    if (!next) setTyped('');
    onOpenChange(next);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {/* Opened without a Radix trigger, so focus would fall to <body> on close; return it to
          whatever opened the dialog. */}
      <AlertDialogContent
        onOpenAutoFocus={() => {
          opener.current = document.activeElement as HTMLElement | null;
        }}
        onCloseAutoFocus={(event) => {
          if (!opener.current?.isConnected) return;
          event.preventDefault();
          opener.current.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmPhrase !== undefined && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              {strings
                .typeToConfirm(confirmPhrase)
                .split(confirmPhrase)
                .flatMap((part, index) =>
                  index === 0
                    ? [part]
                    : [
                        <strong key={index} className="font-semibold">
                          {confirmPhrase}
                        </strong>,
                        part,
                      ],
                )}
            </p>
            <Label htmlFor={inputId} className="sr-only">
              {strings.confirmPhraseLabel}
            </Label>
            <Input
              id={inputId}
              value={typed}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{strings.cancel}</AlertDialogCancel>
          {alternative && (
            <AlertDialogAction variant="outline" onClick={alternative.onSelect}>
              {alternative.label}
            </AlertDialogAction>
          )}
          <AlertDialogAction
            variant="destructive"
            disabled={blocked}
            onClick={() => {
              setTyped('');
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
