/**
 * Fixed ports keep the three E2E servers away from `pnpm dev` (3000, 4400, 5173).
 * E2E_PORT_OFFSET shifts all three so several checkouts can run E2E at the same time.
 */
const OFFSET = Number(process.env.E2E_PORT_OFFSET ?? 0);
export const WEB_PORT = 4173 + OFFSET;
export const API_PORT = 3410 + OFFSET;
export const OIDC_PORT = 4410 + OFFSET;

export const APP_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
export const OIDC_ISSUER = `http://127.0.0.1:${OIDC_PORT}`;
export const OIDC_CLIENT = { id: 'spending-e2e', secret: 'spending-e2e-secret' } as const;

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://spending:spending@127.0.0.1:55440/spending_e2e';

export const E2E_USERS = {
  ann: { sub: 'e2e-ann', email: 'ann@example.test', name: 'Ann Example' },
  bob: { sub: 'e2e-bob', email: 'bob@example.test', name: 'Bob Example' },
} as const;

export type E2EUser = keyof typeof E2E_USERS;
