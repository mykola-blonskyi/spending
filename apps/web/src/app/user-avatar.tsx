import { useState } from 'react';
import type { Profile } from '@data/session';
import { cn } from '@shared/lib/utils';

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

export function UserAvatar({ profile, className }: { profile: Profile; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = profile.avatarUrl !== failedUrl ? profile.avatarUrl : null;

  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-semibold text-accent-foreground select-none',
        className,
      )}
    >
      {url ? (
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        initials(profile.displayName)
      )}
    </span>
  );
}
