import { useId } from 'react';
import { useWorkspaces } from '@data/sync';
import { useTranslations } from '@i18n/index';
import { Label } from '@shared/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';

export type Scope = 'personal' | 'family';
const SCOPES: readonly Scope[] = ['personal', 'family'];

/** Personal or family, offered only to family members (BR-12). Renders nothing otherwise. */
export function ScopeField({
  value,
  onValueChange,
}: {
  value: Scope;
  onValueChange: (scope: Scope) => void;
}) {
  const t = useTranslations('family.scope');
  const labelId = useId();
  const workspaces = useWorkspaces();
  if (!workspaces.items.some((workspace) => workspace.kind === 'family')) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <Label id={labelId}>{t('label')}</Label>
      <ToggleGroup
        type="single"
        variant="outline"
        aria-labelledby={labelId}
        value={value}
        onValueChange={(scope) => {
          if (scope === 'personal' || scope === 'family') onValueChange(scope);
        }}
        className="w-full sm:w-auto"
      >
        {SCOPES.map((scope) => (
          <ToggleGroupItem key={scope} value={scope} className="flex-1 px-4 sm:flex-none">
            {t(scope)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
