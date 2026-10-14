let token: string | undefined;

export function setCsrfToken(value: string): void {
  token = value;
}

export function clearCsrfToken(): void {
  token = undefined;
}

export function getCsrfToken(): string | undefined {
  return token;
}
