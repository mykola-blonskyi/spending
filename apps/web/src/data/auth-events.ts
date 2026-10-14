export type AuthLostCode = 'AUTH_REQUIRED' | 'SESSION_REVOKED';
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
