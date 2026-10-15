import { cn } from '@shared/lib/utils';
import type { Layout } from './registry';

const bar = 'rounded-[2px] bg-muted-foreground/25';
const accent = 'rounded-[2px] bg-primary';
const card = 'rounded-[3px] border border-border bg-card';

/** A 72x48 sketch of each layout's desktop arrangement, drawn with boxes. */
export function LayoutThumbnail({ layout, className }: { layout: Layout; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative h-12 w-[72px] shrink-0 overflow-hidden rounded-md border border-border bg-background',
        layout === 'playful' &&
          'bg-[radial-gradient(circle,var(--border)_0.8px,transparent_1px)] bg-[size:5px_5px]',
        layout === 'soft' && 'bg-muted',
        className,
      )}
    >
      {sketches[layout]}
    </div>
  );
}

const sidebar = (
  <div className="absolute inset-y-0 left-0 flex w-4 flex-col gap-1 border-r border-border bg-card/60 p-1">
    <div className={cn(accent, 'h-1')} />
    <div className={cn(bar, 'h-0.5')} />
    <div className={cn(bar, 'h-0.5')} />
    <div className={cn(bar, 'h-0.5')} />
  </div>
);

const rows = (left: string) => (
  <div className={cn('absolute top-2 right-2 bottom-2 flex flex-col gap-1', left)}>
    <div className={cn(bar, 'h-1 w-2/3')} />
    <div className={cn(card, 'flex-1')} />
    <div className={cn(card, 'flex-1')} />
  </div>
);

const sketches: Record<Layout, React.ReactNode> = {
  calm: (
    <>
      {sidebar}
      {rows('left-6')}
    </>
  ),
  cards: (
    <div className="absolute inset-y-0 left-1/2 flex w-7 -translate-x-1/2 flex-col gap-1 border-x border-border bg-card p-1 pt-1.5">
      <div className={cn(accent, 'h-3 rounded-[3px]')} />
      <div className={cn(bar, 'h-2')} />
      <div className={cn(bar, 'h-2')} />
      <div className="mt-auto flex justify-around">
        <div className={cn(accent, 'size-1')} />
        <div className={cn(bar, 'size-1')} />
        <div className={cn(bar, 'size-1')} />
      </div>
    </div>
  ),
  soft: (
    <>
      <div className="absolute top-1.5 left-1/2 flex h-2.5 -translate-x-1/2 items-center gap-1 rounded-full bg-card px-1">
        <div className={cn(accent, 'h-1 w-3 rounded-full')} />
        <div className={cn(bar, 'h-1 w-2 rounded-full')} />
        <div className={cn(bar, 'h-1 w-2 rounded-full')} />
      </div>
      <div className="absolute top-6 right-3 bottom-3 left-3 flex gap-1">
        <div className={cn(card, 'flex-1 rounded-lg')} />
        <div className={cn(card, 'flex-1 rounded-lg')} />
      </div>
    </>
  ),
  journal: (
    <div className="absolute inset-y-0 left-1/2 flex w-8 -translate-x-1/2 flex-col gap-1 py-2">
      <div className="flex gap-1.5 border-b border-border pb-0.5">
        <div className={cn(accent, 'h-0.5 w-2')} />
        <div className={cn(bar, 'h-0.5 w-2')} />
      </div>
      <div className="relative flex-1 pl-2">
        <div className="absolute top-0 bottom-0 left-0.5 w-px bg-border" />
        <div className="flex flex-col gap-1">
          <div className={cn(bar, 'h-0.5 w-4')} />
          <div className={cn(bar, 'h-0.5 w-5')} />
          <div className={cn(bar, 'h-0.5 w-3')} />
        </div>
      </div>
    </div>
  ),
  bento: (
    <>
      <div className="absolute inset-y-0 left-0 flex w-2.5 flex-col items-center gap-1 border-r border-border bg-card py-1">
        <div className={cn(accent, 'size-1')} />
        <div className={cn(bar, 'size-1')} />
        <div className={cn(bar, 'size-1')} />
      </div>
      <div className="absolute top-2 right-2 bottom-2 left-4 grid grid-cols-3 grid-rows-2 gap-1">
        <div className={cn(card, 'col-span-2')} />
        <div className={card} />
        <div className={card} />
        <div className={cn(card, 'col-span-2')} />
      </div>
    </>
  ),
  split: (
    <>
      {sidebar}
      <div className="absolute inset-y-0 left-4 flex w-5 flex-col gap-1 border-r border-border p-1 pt-2">
        <div className={cn(accent, 'h-1 opacity-60')} />
        <div className={cn(bar, 'h-1')} />
        <div className={cn(bar, 'h-1')} />
      </div>
      <div className="absolute top-2 right-2 bottom-2 left-11 flex flex-col gap-1 rounded-[3px] bg-card p-1">
        <div className={cn(bar, 'h-1 w-2/3')} />
        <div className={cn(bar, 'h-0.5 w-full')} />
      </div>
    </>
  ),
  playful: (
    <>
      <div className="absolute top-1.5 left-2 flex gap-1">
        <div className="h-1.5 w-3 rounded-full bg-foreground" />
        <div className={cn(bar, 'h-1.5 w-2 rounded-full')} />
      </div>
      <div className="absolute top-5 right-2 bottom-2 left-2 flex gap-1">
        <div className={cn(card, 'flex-1 rounded-md')} />
        <div className={cn(card, 'flex-1 rounded-md')} />
      </div>
      <div className="absolute right-1.5 bottom-1.5 size-3 rounded-full bg-primary ring-2 ring-primary/20" />
    </>
  ),
  hybrid: (
    <>
      {sidebar}
      <div className="absolute top-2 right-2 bottom-2 left-6 grid grid-cols-3 grid-rows-2 gap-1">
        <div className={cn(card, 'col-span-2')} />
        <div className={card} />
        <div className={cn(card, 'col-span-3 flex gap-1 p-0.5')}>
          <div className={cn(bar, 'h-full w-1/3')} />
          <div className={cn(bar, 'h-full flex-1 opacity-50')} />
        </div>
      </div>
    </>
  ),
};
