export const AUTH_LOST_CODES = ['AUTH_REQUIRED', 'SESSION_REVOKED'] as const;
export type AuthLostCode = (typeof AUTH_LOST_CODES)[number];
type AuthLostListener = (code: AuthLostCode) => void;

const listeners = new Set<AuthLostListener>();

export function onAuthLost(listener: AuthLostListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAuthLost(code: AuthLostCode): void {
  for (const listener of [...listeners]) listener(code);
}
