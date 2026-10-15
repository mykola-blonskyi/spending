import { useIsDesktop } from '@shared/lib/media';
import { useEntryForm } from '../use-entry-form';
import { CalmEntryView } from './calm-entry';
import { CardsEntryView } from './cards-entry';

/** Hybrid: the keypad entry on phones, the calm form on desktop, over one form state. */
export function HybridEntry() {
  const form = useEntryForm();
  return useIsDesktop() ? <CalmEntryView form={form} /> : <CardsEntryView form={form} />;
}
