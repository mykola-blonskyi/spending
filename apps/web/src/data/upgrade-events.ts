type UpgradeRequiredListener = () => void;

const listeners = new Set<UpgradeRequiredListener>();

/** The server refused this client as older than its sync protocol: a new version must load. */
export function onUpgradeRequired(listener: UpgradeRequiredListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitUpgradeRequired(): void {
  for (const listener of [...listeners]) listener();
}
