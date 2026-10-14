import { defineConfig, devices } from '@playwright/test';
import {
  API_ORIGIN,
  API_PORT,
  APP_ORIGIN,
  E2E_DATABASE_URL,
  E2E_USERS,
  OIDC_CLIENT,
  OIDC_ISSUER,
  OIDC_PORT,
  WEB_PORT,
} from './e2e/support/env';

// Every server runs as a direct `node` process: pnpm does not forward the stop signal, which
// leaves servers running. None is reused, so each run starts from a freshly migrated database.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  // One API and one database serve every test, and each test starts by emptying the tables.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: APP_ORIGIN, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'fake OIDC',
      cwd: '../api',
      command: `node --import tsx test/fake-oidc/main.ts --port ${OIDC_PORT}`,
      url: `${OIDC_ISSUER}/.well-known/openid-configuration`,
      env: {
        FAKE_OIDC_CLIENT_ID: OIDC_CLIENT.id,
        FAKE_OIDC_CLIENT_SECRET: OIDC_CLIENT.secret,
        FAKE_OIDC_APP_ORIGIN: APP_ORIGIN,
        FAKE_OIDC_USERS: JSON.stringify(Object.values(E2E_USERS)),
      },
    },
    {
      name: 'API',
      command: 'node e2e/support/start-api.ts',
      url: `${API_ORIGIN}/api/health`,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL: E2E_DATABASE_URL,
        APP_ORIGIN,
        OIDC_ISSUER,
        OIDC_CLIENT_ID: OIDC_CLIENT.id,
        OIDC_CLIENT_SECRET: OIDC_CLIENT.secret,
        SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        COOKIE_SECURE: 'false',
      },
    },
    {
      name: 'web',
      command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: APP_ORIGIN,
      env: { API_ORIGIN },
    },
  ],
});
