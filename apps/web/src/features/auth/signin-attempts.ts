const ATTEMPTS_KEY = 'spending.signin.attempts';
const DISMISSED_KEY = 'spending.signin.hintDismissed';

/** A pending or ungranted user never comes back with an error (ADR-003), so repeated attempts are the only signal. */
export const ATTEMPTS_BEFORE_HINT = 2;

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Without storage the hint simply never appears.
  }
}

export function recordSignInAttempt(): void {
  write(ATTEMPTS_KEY, String(signInAttempts() + 1));
}

export function signInAttempts(): number {
  const count = Number(read(ATTEMPTS_KEY));
  return Number.isInteger(count) && count > 0 ? count : 0;
}

export function shouldShowApprovalHint(): boolean {
  return signInAttempts() >= ATTEMPTS_BEFORE_HINT && read(DISMISSED_KEY) === null;
}

export function dismissApprovalHint(): void {
  write(DISMISSED_KEY, '1');
}

export function resetSignInAttempts(): void {
  write(ATTEMPTS_KEY, null);
  write(DISMISSED_KEY, null);
}
