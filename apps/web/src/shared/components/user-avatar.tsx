import { useState } from 'react';
import { cn } from '@shared/lib/utils';

export type AvatarUser = { displayName: string; avatarUrl: string | null };

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

/** A picture when there is one, else initials. Decorative: name the person in text next to it. */
export function UserAvatar({ user, className }: { user: AvatarUser; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = user.avatarUrl !== failedUrl ? user.avatarUrl : null;

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
        initials(user.displayName)
      )}
    </span>
  );
}
