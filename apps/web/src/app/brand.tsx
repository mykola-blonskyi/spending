import { Link } from 'react-router';
import { cn } from '@shared/lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M9 19.5c0 2.2 3.1 3.5 7 3.5s7-1.3 7-3.5-3.1-3-7-3.5-7-1.3-7-3.5S12.1 9 16 9s7 1.3 7 3.5"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="stroke-primary-foreground"
      />
    </svg>
  );
}

export function Brand({ name }: { name: string }) {
  return (
    <Link
      to="/"
      className="flex items-center gap-2.5 rounded-md text-[17px] font-semibold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
    >
      <BrandMark />
      {name}
    </Link>
  );
}
